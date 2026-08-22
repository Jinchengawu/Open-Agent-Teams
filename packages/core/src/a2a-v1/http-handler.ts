import { validateA2AV1AgentCardTruthfulness } from './agent-card-truthfulness.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { A2AV1IdempotencyConflictError } from './sqlite-repository.js';
import type { A2AV1PushNotificationService } from './push-notification.js';
import { A2A_V1_IMPLEMENTED_OPERATIONS, type A2AV1TaskStreamEvent, type A2AV1Transport, type A2AV1TransportCapabilities } from './transport.js';
import { A2A_V1_TASK_STATES, type A2AV1AgentCard, type A2AV1AgentInterface, type A2AV1Message, type A2AV1Task, type A2AV1TaskState } from './types.js';

export interface A2AV1HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface A2AV1HttpResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  stream?: AsyncIterable<{ cursor: number; payload: unknown }>;
}

export interface A2AV1TrustedAuthContext {
  tenantId: string;
  projectId: string;
  principalId: string;
}

export type A2AV1HttpAuthenticate = (
  request: Readonly<A2AV1HttpRequest>,
) => Promise<A2AV1TrustedAuthContext | undefined>;

export class A2AV1HttpHandler {
  readonly capabilities: A2AV1TransportCapabilities;
  private readonly baseUrl: string;

  constructor(private readonly options: {
    transport: A2AV1Transport;
    baseUrl: string;
    authenticate: A2AV1HttpAuthenticate;
    cursorSigningKey: string;
    additionalInterfaces?: readonly A2AV1AgentInterface[];
    pushNotifications?: A2AV1PushNotificationService;
  }) {
    if (!options.cursorSigningKey.trim()) throw new Error('cursorSigningKey is required');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.capabilities = Object.freeze({
      protocolVersion: '1.0',
      protocolBinding: 'HTTP+JSON',
      interfaceUrl: `${this.baseUrl}/a2a/v1/agents/{agentId}`,
      operations: A2A_V1_IMPLEMENTED_OPERATIONS,
      streaming: true,
      pushNotifications: Boolean(options.pushNotifications),
      subscribe: true,
    });
  }

  async handle(request: A2AV1HttpRequest): Promise<A2AV1HttpResponse> {
    let auth: A2AV1TrustedAuthContext | undefined;
    try {
      auth = await this.options.authenticate(Object.freeze({ ...request, headers: Object.freeze({ ...request.headers }) }));
    } catch {
      return unauthorized();
    }
    if (!auth?.tenantId?.trim() || !auth.projectId?.trim() || !auth.principalId?.trim()) return unauthorized();
    const url = new URL(request.path, this.baseUrl);
    const method = request.method.toUpperCase();
    const requiresV1 = url.pathname.startsWith('/a2a/v1/');
    const requestedVersion = headerValue(request.headers, 'a2a-version');
    if (requiresV1 && requestedVersion !== this.capabilities.protocolVersion) {
      return errorResponse(
        400,
        'FAILED_PRECONDITION',
        `The requested A2A protocol version '${requestedVersion ?? '(missing)'}' is not supported`,
        'VERSION_NOT_SUPPORTED',
      );
    }
    if (requiresV1) {
      const streaming = /\/message:stream$|\/tasks\/[^/]+:subscribe$/.test(url.pathname);
      const accept = headerValue(request.headers, 'accept');
      if (accept && !acceptsMediaType(accept, streaming ? 'text/event-stream' : 'application/json')) {
        return errorResponse(406, 'INVALID_ARGUMENT', 'Requested response content type is not supported', 'CONTENT_TYPE_NOT_SUPPORTED');
      }
      const contentType = headerValue(request.headers, 'content-type');
      if (!['GET', 'HEAD', 'DELETE'].includes(method) && request.body !== undefined && !isJsonMediaType(contentType)) {
        return errorResponse(415, 'INVALID_ARGUMENT', 'Request content type is not supported', 'CONTENT_TYPE_NOT_SUPPORTED');
      }
    }
    try {
      const cardMatch = url.pathname.match(/^\/\.well-known\/a2a\/agents\/([^/]+)\/agent-card\.json$/);
      if (method === 'GET' && cardMatch) {
        const agentId = decodeURIComponent(cardMatch[1]);
        const internal = await this.options.transport.getAgentCard(auth.tenantId, agentId);
        if (!internal) return notFound('AgentCard not found');
        const card: A2AV1AgentCard = {
          ...internal,
          supportedInterfaces: [{
            url: this.capabilities.interfaceUrl.replace('{agentId}', encodeURIComponent(agentId)),
            protocolBinding: this.capabilities.protocolBinding,
            protocolVersion: this.capabilities.protocolVersion,
          }, ...(this.options.additionalInterfaces ?? []).map((candidate) => ({
            ...candidate,
            url: candidate.url.replace('{agentId}', encodeURIComponent(agentId)),
          }))],
          capabilities: {
            ...internal.capabilities,
            streaming: true,
            pushNotifications: this.capabilities.pushNotifications,
            extendedAgentCard: false,
          },
        };
        const truth = validateA2AV1AgentCardTruthfulness({
          agentId, agentCard: card, transportCapabilities: this.capabilities,
          exposedOperations: [...this.capabilities.operations],
        });
        if (!truth.valid) return internalError();
        return { status: 200, body: card };
      }

      const sendMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/messages:send$/);
      if (method === 'POST' && sendMatch) {
        const body = requireRecord(request.body);
        const agentId = decodeURIComponent(sendMatch[1]);
        const idempotencyKey = requireString(body.idempotencyKey, 'idempotencyKey');
        const task = await this.options.transport.sendMessage({
          tenantId: auth.tenantId,
          trustedProjectId: auth.projectId,
          agentId,
          idempotencyKey,
          message: requireRecord(body.message) as unknown as A2AV1Message,
        });
        this.options.pushNotifications?.enqueuePersistedTask({ tenantId: auth.tenantId, agentId, taskId: task.id, eventId: idempotencyKey });
        return { status: 200, body: task };
      }

      // Official A2A v1 HTTP+JSON binding. Kept alongside the bounded DAT
      // convenience route above so existing callers are not broken.
      const officialSendMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/message:send$/);
      if (method === 'POST' && officialSendMatch) {
        const body = requireRecord(request.body);
        const message = requireRecord(body.message) as unknown as A2AV1Message;
        const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata as Record<string, unknown>
          : {};
        const agentId = decodeURIComponent(officialSendMatch[1]);
        const idempotencyKey = typeof metadata.idempotencyKey === 'string' && metadata.idempotencyKey.trim()
          ? metadata.idempotencyKey : `a2a-send-${message.messageId}`;
        const task = await this.options.transport.sendMessage({
          tenantId: auth.tenantId,
          trustedProjectId: auth.projectId,
          agentId, idempotencyKey,
          message,
        });
        this.options.pushNotifications?.enqueuePersistedTask({ tenantId: auth.tenantId, agentId, taskId: task.id, eventId: idempotencyKey });
        return { status: 200, body: { task } };
      }

      const officialStreamMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/message:stream$/);
      if (method === 'POST' && officialStreamMatch) {
        const body = requireRecord(request.body);
        const message = requireRecord(body.message) as unknown as A2AV1Message;
        const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata as Record<string, unknown>
          : {};
        return sse(this.options.transport.sendMessageStream({
          tenantId: auth.tenantId,
          trustedProjectId: auth.projectId,
          agentId: decodeURIComponent(officialStreamMatch[1]),
          idempotencyKey: typeof metadata.idempotencyKey === 'string' && metadata.idempotencyKey.trim()
            ? metadata.idempotencyKey
            : `a2a-stream-${message.messageId}`,
          message,
        }));
      }

      const cancelMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/tasks\/([^/]+):cancel$/);
      if (method === 'POST' && cancelMatch) {
        const body = request.body === undefined ? {} : requireRecord(request.body);
        const agentId = decodeURIComponent(cancelMatch[1]);
        const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey : `a2a-cancel-${decodeURIComponent(cancelMatch[2])}`;
        const task = await this.options.transport.cancelTask({
          tenantId: auth.tenantId,
          agentId,
          taskId: decodeURIComponent(cancelMatch[2]),
          idempotencyKey,
        });
        this.options.pushNotifications?.enqueuePersistedTask({ tenantId: auth.tenantId, agentId, taskId: task.id, eventId: idempotencyKey });
        return { status: 200, body: task };
      }

      const pushCollectionMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/tasks\/([^/]+)\/pushNotificationConfigs$/);
      if (pushCollectionMatch && (method === 'POST' || method === 'GET')) {
        if (!this.options.pushNotifications) return notFound('Route not found');
        const agentId = decodeURIComponent(pushCollectionMatch[1]);
        const taskId = decodeURIComponent(pushCollectionMatch[2]);
        const task = await this.options.transport.getTask({ tenantId: auth.tenantId, taskId });
        if (!task || readTaskAgentId(task) !== agentId) return notFound('Task not found');
        if (method === 'POST') {
          const body = requireRecord(request.body);
          const config = await this.options.pushNotifications.setConfig({
            tenantId: auth.tenantId, agentId, taskId,
            id: requireString(body.id, 'id'), url: requireString(body.url, 'url'),
            ...(typeof body.token === 'string' ? { token: body.token } : {}),
            ...(body.authentication && typeof body.authentication === 'object' && !Array.isArray(body.authentication)
              ? { authentication: body.authentication as { schemes?: string[]; credentials?: string } } : {}),
          });
          return { status: 201, body: config };
        }
        const requestedPageSize = Number(url.searchParams.get('pageSize'));
        return { status: 200, body: this.options.pushNotifications.listConfigs({
          tenantId: auth.tenantId, agentId, taskId,
          ...(Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? { pageSize: requestedPageSize } : {}),
          ...(url.searchParams.get('pageToken') ? { pageToken: url.searchParams.get('pageToken')! } : {}),
        }) };
      }

      const pushItemMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/);
      if (pushItemMatch && (method === 'GET' || method === 'DELETE')) {
        if (!this.options.pushNotifications) return notFound('Route not found');
        const agentId = decodeURIComponent(pushItemMatch[1]);
        const taskId = decodeURIComponent(pushItemMatch[2]);
        const id = decodeURIComponent(pushItemMatch[3]);
        const task = await this.options.transport.getTask({ tenantId: auth.tenantId, taskId });
        if (!task || readTaskAgentId(task) !== agentId) return notFound('Task not found');
        if (method === 'GET') {
          const config = this.options.pushNotifications.getConfig({ tenantId: auth.tenantId, agentId, taskId, id });
          return config ? { status: 200, body: config } : notFound('Push notification config not found');
        }
        return this.options.pushNotifications.deleteConfig({ tenantId: auth.tenantId, agentId, taskId, id })
          ? { status: 204 } : notFound('Push notification config not found');
      }

      // A2A v1 REST binding routes. Agent scope is resolved from the durable
      // Task and never accepted from request headers/body.
      const officialPushCollectionMatch = url.pathname.match(/^\/a2a\/v1\/tasks\/([^/]+)\/pushNotificationConfigs$/);
      if (officialPushCollectionMatch && (method === 'POST' || method === 'GET')) {
        if (!this.options.pushNotifications) return notFound('Route not found');
        const taskId = decodeURIComponent(officialPushCollectionMatch[1]);
        const task = await this.options.transport.getTask({ tenantId: auth.tenantId, taskId });
        const agentId = task && readTaskAgentId(task);
        if (!agentId) return notFound('Task not found');
        if (method === 'POST') {
          const body = requireRecord(request.body);
          return { status: 201, body: await this.options.pushNotifications.setConfig({
            tenantId: auth.tenantId, agentId, taskId,
            id: requireString(body.id, 'id'), url: requireString(body.url, 'url'),
            ...(typeof body.token === 'string' ? { token: body.token } : {}),
            ...(body.authentication && typeof body.authentication === 'object' && !Array.isArray(body.authentication)
              ? { authentication: body.authentication as { schemes?: string[]; credentials?: string } } : {}),
          }) };
        }
        const pageSize = Number(url.searchParams.get('pageSize'));
        return { status: 200, body: this.options.pushNotifications.listConfigs({ tenantId: auth.tenantId, agentId, taskId,
          ...(Number.isInteger(pageSize) && pageSize > 0 ? { pageSize } : {}),
          ...(url.searchParams.get('pageToken') ? { pageToken: url.searchParams.get('pageToken')! } : {}) }) };
      }

      const officialPushItemMatch = url.pathname.match(/^\/a2a\/v1\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/);
      if (officialPushItemMatch && (method === 'GET' || method === 'DELETE')) {
        if (!this.options.pushNotifications) return notFound('Route not found');
        const taskId = decodeURIComponent(officialPushItemMatch[1]);
        const id = decodeURIComponent(officialPushItemMatch[2]);
        const task = await this.options.transport.getTask({ tenantId: auth.tenantId, taskId });
        const agentId = task && readTaskAgentId(task);
        if (!agentId) return notFound('Task not found');
        if (method === 'GET') {
          const config = this.options.pushNotifications.getConfig({ tenantId: auth.tenantId, agentId, taskId, id });
          return config ? { status: 200, body: config } : notFound('Push notification config not found');
        }
        return this.options.pushNotifications.deleteConfig({ tenantId: auth.tenantId, agentId, taskId, id })
          ? { status: 204 } : notFound('Push notification config not found');
      }

      const officialTaskMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/tasks\/([^/]+)$/);
      if (method === 'GET' && officialTaskMatch) {
        const agentId = decodeURIComponent(officialTaskMatch[1]);
        const task = await this.options.transport.getTask({
          tenantId: auth.tenantId,
          taskId: decodeURIComponent(officialTaskMatch[2]),
        });
        const historyLength = parseOptionalNonNegativeInteger(url.searchParams, 'historyLength', 1_000);
        return task && readTaskAgentId(task) === agentId
          ? { status: 200, body: projectTask(task, historyLength, true) }
          : notFound('Task not found');
      }

      const subscribeMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/tasks\/([^/]+):subscribe$/);
      if (method === 'POST' && subscribeMatch) {
        const agentId = decodeURIComponent(subscribeMatch[1]);
        const taskId = decodeURIComponent(subscribeMatch[2]);
        // Validate authorization scope before committing a 200 SSE response. An
        // async generator does not execute until after headers are sent, so
        // relying on subscribeTask() alone would turn tenant/agent misses into
        // a late stream failure instead of a fail-closed HTTP response.
        const task = await this.options.transport.getTask({ tenantId: auth.tenantId, taskId });
        if (!task || readTaskAgentId(task) !== agentId) return notFound('Task not found');
        return sse(this.options.transport.subscribeTask({
          tenantId: auth.tenantId,
          agentId,
          taskId,
          afterCursor: parseCursor(request.headers['last-event-id']),
          signal: request.signal,
        }));
      }

      const officialListMatch = url.pathname.match(/^\/a2a\/v1\/agents\/([^/]+)\/tasks$/);
      if (method === 'GET' && officialListMatch) {
        const agentId = decodeURIComponent(officialListMatch[1]);
        const contextId = url.searchParams.get('contextId') ?? '';
        const status = url.searchParams.get('status') as A2AV1TaskState | null;
        if (status && !(A2A_V1_TASK_STATES as readonly string[]).includes(status)) {
          throw new HttpInputError('status is not a valid A2A Task state');
        }
        const statusTimestampAfter = parseOptionalTimestamp(url.searchParams, 'statusTimestampAfter');
        const historyLength = parseOptionalNonNegativeInteger(url.searchParams, 'historyLength', 1_000);
        const includeArtifacts = parseOptionalBoolean(url.searchParams, 'includeArtifacts') ?? true;
        const rawTasks = await this.options.transport.listTasks({
          tenantId: auth.tenantId,
          agentId,
          ...(contextId ? { contextId } : {}),
          ...(status && status !== 'TASK_STATE_UNSPECIFIED' ? { states: [status] } : {}),
        });
        const tasks = rawTasks
          .filter((task) => statusTimestampAfter === undefined
            || (task.status.timestamp !== undefined && Date.parse(task.status.timestamp) > statusTimestampAfter))
          .map((task) => projectTask(task, historyLength, includeArtifacts));
        const requestedPageSize = Number(url.searchParams.get('pageSize'));
        const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
          ? Math.min(requestedPageSize, 100)
          : Math.min(Math.max(tasks.length, 1), 50);
        const cursorScope = {
          tenantId: auth.tenantId,
          agentId,
          contextId,
          status: status && status !== 'TASK_STATE_UNSPECIFIED' ? status : '',
          statusTimestampAfter: url.searchParams.get('statusTimestampAfter') ?? '',
          historyLength: historyLength === undefined ? '' : String(historyLength),
          includeArtifacts: String(includeArtifacts),
        };
        const offset = parseTaskPageToken(url.searchParams.get('pageToken'), cursorScope, this.options.cursorSigningKey);
        const nextOffset = offset + pageSize;
        return {
          status: 200,
          body: {
            tasks: tasks.slice(offset, nextOffset),
            nextPageToken: nextOffset < tasks.length ? encodeTaskPageToken(nextOffset, cursorScope, this.options.cursorSigningKey) : '',
            pageSize,
            totalSize: tasks.length,
          },
        };
      }

      const taskMatch = url.pathname.match(/^\/a2a\/v1\/tasks\/([^/]+)$/);
      if (method === 'GET' && taskMatch) {
        const task = await this.options.transport.getTask({ tenantId: auth.tenantId, taskId: decodeURIComponent(taskMatch[1]) });
        return task ? { status: 200, body: task } : notFound('Task not found');
      }

      if (method === 'GET' && url.pathname === '/a2a/v1/tasks') {
        const stateValues = url.searchParams.getAll('state') as A2AV1TaskState[];
        const tasks = await this.options.transport.listTasks({
          tenantId: auth.tenantId,
          ...(url.searchParams.get('agentId') ? { agentId: url.searchParams.get('agentId')! } : {}),
          ...(url.searchParams.get('contextId') ? { contextId: url.searchParams.get('contextId')! } : {}),
          ...(stateValues.length ? { states: stateValues } : {}),
        });
        return { status: 200, body: tasks };
      }
      return notFound('Route not found');
    } catch (error) {
      return mapError(error);
    }
  }
}

function readTaskAgentId(task: { metadata?: Record<string, unknown> }): string | undefined {
  const metadata = task.metadata?.devAgentTeams;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const agentId = (metadata as Record<string, unknown>).agentId;
  return typeof agentId === 'string' ? agentId : undefined;
}

function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return value;
  }
  return undefined;
}

function isJsonMediaType(value: string | undefined): boolean {
  if (!value) return false;
  const mediaType = value.split(';', 1)[0]!.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType === 'application/a2a+json';
}

function acceptsMediaType(value: string, expected: 'application/json' | 'text/event-stream'): boolean {
  return value.split(',').some((entry) => {
    const mediaType = entry.split(';', 1)[0]!.trim().toLowerCase();
    if (mediaType === '*/*') return true;
    if (expected === 'application/json') {
      return mediaType === 'application/json' || mediaType === 'application/a2a+json' || mediaType === 'application/*';
    }
    return mediaType === 'text/event-stream' || mediaType === 'text/*';
  });
}

function sse(stream: AsyncIterable<A2AV1TaskStreamEvent>): A2AV1HttpResponse {
  return { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }, stream };
}

function parseCursor(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpInputError('Last-Event-ID must be a non-negative integer cursor');
  return cursor;
}

type TaskPageCursorScope = {
  tenantId: string;
  agentId: string;
  contextId: string;
  status: string;
  statusTimestampAfter: string;
  historyLength: string;
  includeArtifacts: string;
};

function encodeTaskPageToken(offset: number, scope: TaskPageCursorScope, signingKey: string): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, offset, ...scope }), 'utf8').toString('base64url');
  return `${payload}.${signTaskPageCursor(payload, signingKey)}`;
}

function parseTaskPageToken(value: string | null, expected: TaskPageCursorScope, signingKey: string): number {
  if (!value) return 0;
  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) throw new Error('malformed');
    const expectedSignature = signTaskPageCursor(payload, signingKey);
    const actualBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expectedSignature, 'base64url');
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) throw new Error('bad-signature');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (parsed.version !== 1 || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0
      || parsed.tenantId !== expected.tenantId || parsed.agentId !== expected.agentId
      || parsed.contextId !== expected.contextId || parsed.status !== expected.status
      || parsed.statusTimestampAfter !== expected.statusTimestampAfter
      || parsed.historyLength !== expected.historyLength
      || parsed.includeArtifacts !== expected.includeArtifacts) {
      throw new Error('scope-mismatch');
    }
    return Number(parsed.offset);
  } catch {
    throw new HttpInputError('pageToken is invalid for this task collection');
  }
}

function signTaskPageCursor(payload: string, signingKey: string): string {
  return createHmac('sha256', signingKey).update(payload).digest('base64url');
}

function parseOptionalNonNegativeInteger(params: URLSearchParams, name: string, maximum: number): number | undefined {
  if (!params.has(name)) return undefined;
  const raw = params.get(name)!;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value > maximum) {
    throw new HttpInputError(`${name} must be a non-negative integer no greater than ${maximum}`);
  }
  return value;
}

function parseOptionalTimestamp(params: URLSearchParams, name: string): number | undefined {
  if (!params.has(name)) return undefined;
  const raw = params.get(name)!;
  const value = Date.parse(raw);
  if (!raw || !Number.isFinite(value)) throw new HttpInputError(`${name} must be an RFC 3339 timestamp`);
  return value;
}

function parseOptionalBoolean(params: URLSearchParams, name: string): boolean | undefined {
  if (!params.has(name)) return undefined;
  const raw = params.get(name);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new HttpInputError(`${name} must be true or false`);
}

function projectTask(task: A2AV1Task, historyLength: number | undefined, includeArtifacts: boolean): A2AV1Task {
  const projected = structuredClone(task);
  if (historyLength !== undefined) projected.history = historyLength === 0 ? [] : (projected.history ?? []).slice(-historyLength);
  if (!includeArtifacts) delete projected.artifacts;
  return projected;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpInputError('JSON object body is required');
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpInputError(`${field} is required`);
  return value;
}

class HttpInputError extends Error {}

function mapError(error: unknown): A2AV1HttpResponse {
  if (error instanceof HttpInputError) return badRequest(error.message);
  if (error instanceof A2AV1IdempotencyConflictError) return errorResponse(409, 'CONFLICT', 'Idempotency conflict');
  const message = error instanceof Error ? error.message : '';
  if (/invalid|requires ROLE_USER|supports new Task/i.test(message)) return badRequest('Invalid request');
  if (/not found|not registered/i.test(message)) return notFound('Task not found');
  return internalError();
}

function unauthorized(): A2AV1HttpResponse {
  return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
}
function badRequest(message: string): A2AV1HttpResponse {
  return errorResponse(400, 'INVALID_ARGUMENT', message, 'INVALID_PARAMS');
}
function notFound(message: string): A2AV1HttpResponse {
  return errorResponse(404, 'NOT_FOUND', message, 'TASK_NOT_FOUND');
}
function internalError(): A2AV1HttpResponse {
  return errorResponse(500, 'INTERNAL', 'Internal server error');
}
function errorResponse(status: number, statusName: string, message: string, reason?: string): A2AV1HttpResponse {
  return {
    status,
    body: {
      error: {
        code: status,
        status: statusName,
        message,
        details: reason ? [{
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason,
          domain: 'a2a-protocol.org',
        }] : [],
      },
    },
  };
}
