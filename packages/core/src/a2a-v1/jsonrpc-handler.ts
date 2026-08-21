import { createHmac, timingSafeEqual } from 'node:crypto';
import type { A2AV1HttpAuthenticate, A2AV1HttpRequest, A2AV1HttpResponse } from './http-handler.js';
import type { A2AV1Message, A2AV1Task, A2AV1TaskState } from './types.js';
import { A2A_V1_TASK_STATES } from './types.js';
import type { A2AV1Transport } from './transport.js';

type RpcId = string | number | null;
type RpcRequest = { jsonrpc: '2.0'; id: RpcId; method: string; params: Record<string, unknown> };

const PUSH_METHODS = new Set([
  'CreateTaskPushNotificationConfig', 'GetTaskPushNotificationConfig',
  'ListTaskPushNotificationConfigs', 'DeleteTaskPushNotificationConfig',
]);

/** Bounded A2A v1 JSON-RPC binding. Push and extended cards are deliberately unsupported. */
export class A2AV1JsonRpcHandler {
  constructor(private readonly options: {
    transport: A2AV1Transport;
    authenticate: A2AV1HttpAuthenticate;
    cursorSigningKey: string;
  }) {
    if (!options.cursorSigningKey.trim()) throw new Error('cursorSigningKey is required');
  }

  async handle(request: A2AV1HttpRequest): Promise<A2AV1HttpResponse> {
    let auth;
    try { auth = await this.options.authenticate(Object.freeze({ ...request, headers: Object.freeze({ ...request.headers }) })); }
    catch { return httpError(401, 'UNAUTHENTICATED', 'Authentication required'); }
    if (!auth?.tenantId?.trim() || !auth.projectId?.trim() || !auth.principalId?.trim()) {
      return httpError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (request.method.toUpperCase() !== 'POST') return httpError(405, 'METHOD_NOT_ALLOWED', 'JSON-RPC requires POST');
    const version = header(request.headers, 'a2a-version');
    if (version !== '1.0') return httpError(400, 'FAILED_PRECONDITION', `The requested A2A protocol version '${version ?? '(missing)'}' is not supported`);
    if (!jsonContentType(header(request.headers, 'content-type'))) return httpError(415, 'INVALID_ARGUMENT', 'Request content type is not supported');

    let rpc: RpcRequest;
    try { rpc = parseRpcRequest(request.body); }
    catch { return { status: 400, body: rpcError(null, -32600, 'Invalid JSON-RPC request') }; }
    const match = new URL(request.path, 'https://a2a.invalid').pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/jsonrpc$/);
    if (!match) return httpError(404, 'NOT_FOUND', 'JSON-RPC endpoint not found');
    const agentId = decodeURIComponent(match[1]);
    const streaming = rpc.method === 'SendStreamingMessage' || rpc.method === 'SubscribeToTask';
    const accept = header(request.headers, 'accept');
    if (accept && !accepts(accept, streaming ? 'text/event-stream' : 'application/json')) {
      return httpError(406, 'INVALID_ARGUMENT', 'Requested response content type is not supported');
    }

    try {
      if (PUSH_METHODS.has(rpc.method)) return { status: 200, body: rpcError(rpc.id, -32003, 'Push Notification is not supported', 'PUSH_NOTIFICATION_NOT_SUPPORTED') };
      if (rpc.method === 'GetExtendedAgentCard') return { status: 200, body: rpcError(rpc.id, -32007, 'Extended Agent Card not configured', 'EXTENDED_AGENT_CARD_NOT_CONFIGURED') };
      switch (rpc.method) {
        case 'SendMessage': {
          const message = requireRecord(rpc.params.message) as unknown as A2AV1Message;
          const metadata = optionalRecord(rpc.params.metadata);
          const task = await this.options.transport.sendMessage({
            tenantId: auth.tenantId, trustedProjectId: auth.projectId, agentId,
            idempotencyKey: stringValue(metadata.idempotencyKey) ?? `a2a-jsonrpc-send-${requireString(message.messageId, 'message.messageId')}`,
            message,
          });
          return result(rpc.id, { task });
        }
        case 'SendStreamingMessage': {
          const message = requireRecord(rpc.params.message) as unknown as A2AV1Message;
          const metadata = optionalRecord(rpc.params.metadata);
          return rpcStream(rpc.id, this.options.transport.sendMessageStream({
            tenantId: auth.tenantId, trustedProjectId: auth.projectId, agentId,
            idempotencyKey: stringValue(metadata.idempotencyKey) ?? `a2a-jsonrpc-stream-${requireString(message.messageId, 'message.messageId')}`,
            message,
          }));
        }
        case 'GetTask': {
          const task = await ownedTask(this.options.transport, auth.tenantId, agentId, requireString(rpc.params.id, 'id'));
          return task ? result(rpc.id, projectTask(task, optionalNonNegativeInteger(rpc.params.historyLength, 'historyLength', 1_000), true))
            : resultError(rpc.id, -32001, 'Task not found', 'TASK_NOT_FOUND');
        }
        case 'ListTasks': return result(rpc.id, await this.listTasks(auth.tenantId, agentId, rpc.params));
        case 'CancelTask': {
          const taskId = requireString(rpc.params.id, 'id');
          if (!await ownedTask(this.options.transport, auth.tenantId, agentId, taskId)) return resultError(rpc.id, -32001, 'Task not found', 'TASK_NOT_FOUND');
          const metadata = optionalRecord(rpc.params.metadata);
          return result(rpc.id, await this.options.transport.cancelTask({
            tenantId: auth.tenantId, agentId, taskId,
            idempotencyKey: stringValue(metadata.idempotencyKey) ?? `a2a-jsonrpc-cancel-${taskId}`,
          }));
        }
        case 'SubscribeToTask': {
          const taskId = requireString(rpc.params.id, 'id');
          if (!await ownedTask(this.options.transport, auth.tenantId, agentId, taskId)) return resultError(rpc.id, -32001, 'Task not found', 'TASK_NOT_FOUND');
          return rpcStream(rpc.id, this.options.transport.subscribeTask({
            tenantId: auth.tenantId, agentId, taskId,
            afterCursor: eventCursor(request.headers), signal: request.signal,
          }));
        }
        default: return resultError(rpc.id, -32601, `Method ${rpc.method} is not supported`, 'UNSUPPORTED_OPERATION');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/not found|not registered/i.test(message)) return resultError(rpc.id, -32001, 'Task not found', 'TASK_NOT_FOUND');
      if (/terminal|transition|cancel/i.test(message)) return resultError(rpc.id, -32002, 'Task cannot be canceled', 'TASK_NOT_CANCELABLE');
      if (/required|invalid|must be|ROLE_USER/i.test(message)) return resultError(rpc.id, -32602, 'Invalid method parameters', 'INVALID_PARAMS');
      return resultError(rpc.id, -32603, 'Internal server error');
    }
  }

  async getAgentInterface(tenantId: string, agentId: string, endpoint: string) {
    const card = await this.options.transport.getAgentCard(tenantId, agentId);
    if (!card) return undefined;
    return {
      url: endpoint,
      protocolBinding: 'JSONRPC' as const,
      protocolVersion: '1.0' as const,
      capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
    };
  }

  private async listTasks(tenantId: string, agentId: string, params: Record<string, unknown>) {
    const contextId = stringValue(params.contextId) ?? '';
    const status = stringValue(params.status) as A2AV1TaskState | undefined;
    if (status && !(A2A_V1_TASK_STATES as readonly string[]).includes(status)) throw new Error('invalid status');
    const afterRaw = stringValue(params.statusTimestampAfter) ?? '';
    const after = afterRaw ? Date.parse(afterRaw) : undefined;
    if (afterRaw && !Number.isFinite(after)) throw new Error('invalid statusTimestampAfter');
    const historyLength = optionalNonNegativeInteger(params.historyLength, 'historyLength', 1_000);
    const includeArtifacts = optionalBoolean(params.includeArtifacts) ?? true;
    const pageSize = optionalNonNegativeInteger(params.pageSize, 'pageSize', 100) || 50;
    const tasks = (await this.options.transport.listTasks({
      tenantId, agentId, ...(contextId ? { contextId } : {}),
      ...(status && status !== 'TASK_STATE_UNSPECIFIED' ? { states: [status] } : {}),
    })).filter((task) => after === undefined || (task.status.timestamp !== undefined && Date.parse(task.status.timestamp) > after))
      .map((task) => projectTask(task, historyLength, includeArtifacts));
    const scope = { tenantId, agentId, contextId, status: status ?? '', afterRaw, historyLength: historyLength ?? null, includeArtifacts };
    const offset = decodeCursor(stringValue(params.pageToken) ?? '', scope, this.options.cursorSigningKey);
    const nextOffset = offset + pageSize;
    return { tasks: tasks.slice(offset, nextOffset), nextPageToken: nextOffset < tasks.length ? encodeCursor(nextOffset, scope, this.options.cursorSigningKey) : '', pageSize, totalSize: tasks.length };
  }
}

function rpcStream(id: RpcId, stream: AsyncIterable<{ cursor: number; payload: { task: A2AV1Task } }>): A2AV1HttpResponse {
  return { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }, stream: (async function* () {
    for await (const event of stream) yield { cursor: event.cursor, payload: { jsonrpc: '2.0', id, result: event.payload } };
  })() };
}
function result(id: RpcId, value: unknown): A2AV1HttpResponse { return { status: 200, body: { jsonrpc: '2.0', id, result: value } }; }
function resultError(id: RpcId, code: number, message: string, reason?: string): A2AV1HttpResponse { return { status: 200, body: rpcError(id, code, message, reason) }; }
function rpcError(id: RpcId, code: number, message: string, reason?: string) { return { jsonrpc: '2.0', id, error: { code, message, ...(reason ? { data: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'a2a-protocol.org' }] } : {}) } }; }
function httpError(status: number, code: string, message: string): A2AV1HttpResponse { return { status, body: { error: { code: status, status: code, message, details: [] } } }; }
function parseRpcRequest(body: unknown): RpcRequest {
  const value = requireRecord(body);
  if (value.jsonrpc !== '2.0' || typeof value.method !== 'string' || !value.method || !('id' in value)
    || !(typeof value.id === 'string' || typeof value.id === 'number' || value.id === null)) throw new Error('invalid rpc');
  return { jsonrpc: '2.0', id: value.id, method: value.method, params: optionalRecord(value.params) };
}
function requireRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required'); return value as Record<string, unknown>; }
function optionalRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function requireString(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`); return value; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value !== '' ? value : undefined; }
function optionalBoolean(value: unknown): boolean | undefined { if (value === undefined) return undefined; if (typeof value !== 'boolean') throw new Error('invalid boolean'); return value; }
function optionalNonNegativeInteger(value: unknown, name: string, max: number): number | undefined { if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) throw new Error(`${name} invalid`); return Number(value); }
function projectTask(task: A2AV1Task, historyLength: number | undefined, includeArtifacts: boolean): A2AV1Task { const copy = structuredClone(task); if (historyLength !== undefined) copy.history = historyLength === 0 ? [] : (copy.history ?? []).slice(-historyLength); if (!includeArtifacts) delete copy.artifacts; return copy; }
function taskAgent(task: A2AV1Task): string | undefined { const value = task.metadata?.devAgentTeams; return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).agentId === 'string' ? (value as Record<string, unknown>).agentId as string : undefined; }
async function ownedTask(transport: A2AV1Transport, tenantId: string, agentId: string, taskId: string) { const task = await transport.getTask({ tenantId, taskId }); return task && taskAgent(task) === agentId ? task : undefined; }
function header(headers: Record<string, string | undefined>, name: string) { return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]; }
function jsonContentType(value: string | undefined) { const type = value?.split(';', 1)[0]?.trim().toLowerCase(); return type === 'application/json' || type === 'application/a2a+json'; }
function accepts(value: string, expected: string) { return value.split(',').some((part) => { const type = part.split(';', 1)[0]!.trim().toLowerCase(); return type === '*/*' || type === expected || (expected === 'application/json' && (type === 'application/a2a+json' || type === 'application/*')) || (expected === 'text/event-stream' && type === 'text/*'); }); }
function eventCursor(headers: Record<string, string | undefined>) { const value = header(headers, 'last-event-id'); if (!value) return undefined; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid Last-Event-ID'); return parsed; }
function encodeCursor(offset: number, scope: object, key: string) { const payload = Buffer.from(JSON.stringify({ v: 1, offset, ...scope })).toString('base64url'); return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`; }
function decodeCursor(value: string, scope: object, key: string) { if (!value) return 0; const [payload, signature, extra] = value.split('.'); if (!payload || !signature || extra !== undefined) throw new Error('invalid pageToken'); const expected = createHmac('sha256', key).update(payload).digest(); const actual = Buffer.from(signature, 'base64url'); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('invalid pageToken'); const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>; const expectedScope = { v: 1, ...scope }; for (const [name, expectedValue] of Object.entries(expectedScope)) if (JSON.stringify(parsed[name]) !== JSON.stringify(expectedValue)) throw new Error('invalid pageToken'); if (!Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) throw new Error('invalid pageToken'); return Number(parsed.offset); }
