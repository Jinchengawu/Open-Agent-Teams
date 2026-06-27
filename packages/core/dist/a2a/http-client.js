export class HttpA2AClient {
    baseUrl;
    headers;
    fetchImpl;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.headers = options.headers || {};
        this.fetchImpl = options.fetchImpl || fetch;
    }
    async listAgentCards() {
        const response = await this.getJson('/a2a/agent-cards');
        return response.cards || [];
    }
    async getAgentCard(agentId) {
        return this.getJson(`/a2a/agent-cards/${encodeURIComponent(agentId)}`);
    }
    async sendMessage(agentId, request) {
        return this.postJson(`/a2a/agents/${encodeURIComponent(agentId)}/message:send`, request);
    }
    async listMessages(agentId) {
        const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
        const response = await this.getJson(`/a2a/messages${query}`);
        return response.messages || [];
    }
    async listTasks(limit = 50) {
        const response = await this.getJson(`/a2a/tasks?limit=${encodeURIComponent(String(limit))}`);
        return response.tasks || [];
    }
    async getTask(taskId) {
        return this.getJson(`/a2a/tasks/${encodeURIComponent(taskId)}`);
    }
    async getJson(path) {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: 'GET',
            headers: this.headers,
        });
        return this.parseJsonResponse(response);
    }
    async postJson(path, body) {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: {
                ...this.headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        return this.parseJsonResponse(response);
    }
    async parseJsonResponse(response) {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = typeof payload.error === 'string' ? payload.error : `A2A HTTP request failed with ${response.status}`;
            throw new Error(message);
        }
        return payload;
    }
}
//# sourceMappingURL=http-client.js.map