import { A2A_V1_IMPLEMENTED_OPERATIONS, type A2AV1CancelTaskCommand, type A2AV1GetTaskQuery, type A2AV1ListTasksQuery, type A2AV1SendMessageCommand, type A2AV1SubscribeTaskQuery, type A2AV1TaskStreamEvent, type A2AV1Transport, type A2AV1TransportCapabilities } from './transport.js';
import type { A2AV1HttpRequest, A2AV1HttpResponse } from './http-handler.js';
import type { A2AV1AgentCard, A2AV1Task } from './types.js';

export class HttpA2AV1Transport implements A2AV1Transport {
  readonly capabilities: A2AV1TransportCapabilities;
  private readonly baseUrl: string;

  constructor(private readonly options: {
    request: (request: A2AV1HttpRequest) => Promise<A2AV1HttpResponse>;
    authorizationForTenant: (tenantId: string) => string;
    baseUrl: string;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.capabilities = Object.freeze({
      protocolVersion: '1.0', protocolBinding: 'HTTP+JSON',
      interfaceUrl: `${this.baseUrl}/a2a/v1/agents/{agentId}`,
      operations: A2A_V1_IMPLEMENTED_OPERATIONS,
      streaming: true, pushNotifications: false, subscribe: true,
    });
  }

  async getAgentCard(tenantId: string, agentId: string): Promise<A2AV1AgentCard | undefined> {
    const response = await this.call(tenantId, 'GET', `/.well-known/a2a/agents/${encodeURIComponent(agentId)}/agent-card.json`);
    return response.status === 404 ? undefined : this.unwrap<A2AV1AgentCard>(response);
  }

  async sendMessage(command: A2AV1SendMessageCommand): Promise<A2AV1Task> {
    return this.unwrap(await this.call(command.tenantId, 'POST', `/a2a/v1/agents/${encodeURIComponent(command.agentId)}/messages:send`, {
      idempotencyKey: command.idempotencyKey, message: command.message,
    }));
  }

  async *sendMessageStream(command: A2AV1SendMessageCommand): AsyncGenerator<A2AV1TaskStreamEvent, void, undefined> {
    const response = await this.call(command.tenantId, 'POST', `/a2a/v1/agents/${encodeURIComponent(command.agentId)}/message:stream`, {
      message: command.message,
      metadata: { idempotencyKey: command.idempotencyKey },
    });
    yield* this.unwrapStream(response);
  }

  async getTask(query: A2AV1GetTaskQuery): Promise<A2AV1Task | undefined> {
    const response = await this.call(query.tenantId, 'GET', `/a2a/v1/tasks/${encodeURIComponent(query.taskId)}`);
    return response.status === 404 ? undefined : this.unwrap<A2AV1Task>(response);
  }

  async listTasks(query: A2AV1ListTasksQuery): Promise<A2AV1Task[]> {
    const search = new URLSearchParams();
    if (query.agentId) search.set('agentId', query.agentId);
    if (query.contextId) search.set('contextId', query.contextId);
    for (const state of query.states ?? []) search.append('state', state);
    return this.unwrap(await this.call(query.tenantId, 'GET', `/a2a/v1/tasks${search.size ? `?${search}` : ''}`));
  }

  async cancelTask(command: A2AV1CancelTaskCommand): Promise<A2AV1Task> {
    return this.unwrap(await this.call(command.tenantId, 'POST', `/a2a/v1/agents/${encodeURIComponent(command.agentId)}/tasks/${encodeURIComponent(command.taskId)}:cancel`, {
      idempotencyKey: command.idempotencyKey,
    }));
  }

  async *subscribeTask(query: A2AV1SubscribeTaskQuery): AsyncGenerator<A2AV1TaskStreamEvent, void, undefined> {
    const response = await this.call(
      query.tenantId,
      'POST',
      `/a2a/v1/agents/${encodeURIComponent(query.agentId)}/tasks/${encodeURIComponent(query.taskId)}:subscribe`,
      undefined,
      {
        ...(query.afterCursor === undefined ? {} : { 'last-event-id': String(query.afterCursor) }),
      },
      query.signal,
    );
    yield* this.unwrapStream(response);
  }

  private call(
    tenantId: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<A2AV1HttpResponse> {
    return this.options.request({
      method, path,
      headers: {
        authorization: this.options.authorizationForTenant(tenantId),
        'A2A-Version': '1.0',
        accept: /\/message:stream$|\/tasks\/[^/]+:subscribe$/.test(path)
          ? 'text/event-stream'
          : 'application/a2a+json, application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body }),
      ...(signal ? { signal } : {}),
    });
  }

  private unwrap<T>(response: A2AV1HttpResponse): T {
    if (response.status >= 200 && response.status < 300) return response.body as T;
    const body = response.body as { error?: { message?: string } } | undefined;
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }

  private async *unwrapStream(response: A2AV1HttpResponse): AsyncGenerator<A2AV1TaskStreamEvent, void, undefined> {
    if (response.status < 200 || response.status >= 300) this.unwrap(response);
    if (!response.stream) throw new Error('HTTP A2A response did not provide an event stream');
    for await (const event of response.stream) yield event as A2AV1TaskStreamEvent;
  }
}
