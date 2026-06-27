import type {
  A2AAgentCard,
  A2AMessage,
  A2ASendMessageRequest,
  A2ASendMessageResult,
  A2ATask,
} from './types.js';

export interface HttpA2AClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export class HttpA2AClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpA2AClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.headers = options.headers || {};
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async listAgentCards(): Promise<A2AAgentCard[]> {
    const response = await this.getJson<{ cards: A2AAgentCard[] }>('/a2a/agent-cards');
    return response.cards || [];
  }

  async getAgentCard(agentId: string): Promise<A2AAgentCard> {
    return this.getJson<A2AAgentCard>(`/a2a/agent-cards/${encodeURIComponent(agentId)}`);
  }

  async sendMessage(agentId: string, request: A2ASendMessageRequest): Promise<A2ASendMessageResult> {
    return this.postJson<A2ASendMessageRequest, A2ASendMessageResult>(
      `/a2a/agents/${encodeURIComponent(agentId)}/message:send`,
      request,
    );
  }

  async listMessages(agentId?: string): Promise<A2AMessage[]> {
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    const response = await this.getJson<{ messages: A2AMessage[] }>(`/a2a/messages${query}`);
    return response.messages || [];
  }

  async listTasks(limit = 50): Promise<A2ATask[]> {
    const response = await this.getJson<{ tasks: A2ATask[] }>(`/a2a/tasks?limit=${encodeURIComponent(String(limit))}`);
    return response.tasks || [];
  }

  async getTask(taskId: string): Promise<A2ATask> {
    return this.getJson<A2ATask>(`/a2a/tasks/${encodeURIComponent(taskId)}`);
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers,
    });
    return this.parseJsonResponse<T>(response);
  }

  private async postJson<TBody, TResult>(path: string, body: TBody): Promise<TResult> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return this.parseJsonResponse<TResult>(response);
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof payload.error === 'string' ? payload.error : `A2A HTTP request failed with ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  }
}
