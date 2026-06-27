import { EventEmitter } from 'events';
import { createA2AMessage } from './converters.js';
export class InProcessA2ATransport {
    handlers = new Map();
    messageHistory = new Map();
    taskHistory = new Map();
    emitter = new EventEmitter();
    registerAgent(card, handler) {
        const agentId = getAgentIdFromCard(card);
        this.handlers.set(agentId, { agentCard: card, handleMessage: handler });
        this.emitter.emit('agent.registered', card);
        return () => {
            this.handlers.delete(agentId);
            this.emitter.emit('agent.unregistered', card);
        };
    }
    getAgentCard(agentId) {
        return this.handlers.get(agentId)?.agentCard;
    }
    listAgentCards() {
        return Array.from(this.handlers.values()).map((handler) => handler.agentCard);
    }
    async sendMessage(toAgentId, request) {
        const handler = this.handlers.get(toAgentId);
        const message = request.message;
        this.appendMessage(toAgentId, message);
        if (!handler) {
            return createA2AMessage({
                role: 'agent',
                contextId: message.contextId,
                taskId: message.taskId,
                text: `Agent ${toAgentId} is not registered on the in-process A2A transport.`,
                metadata: {
                    error: 'agent_not_registered',
                    toAgentId,
                },
            });
        }
        const result = await handler.handleMessage(request);
        if (isTransportTask(result)) {
            this.appendTask(toAgentId, result);
            if (result.history) {
                for (const historyMessage of result.history)
                    this.appendMessage(toAgentId, historyMessage);
            }
        }
        else {
            this.appendMessage(toAgentId, result);
        }
        return result;
    }
    getMessageHistory(agentId) {
        return this.messageHistory.get(agentId) || [];
    }
    getTaskHistory(agentId) {
        return this.taskHistory.get(agentId) || [];
    }
    appendMessage(agentId, message) {
        const history = this.messageHistory.get(agentId) || [];
        history.push(message);
        this.messageHistory.set(agentId, history);
    }
    appendTask(agentId, task) {
        const history = this.taskHistory.get(agentId) || [];
        history.push(task);
        this.taskHistory.set(agentId, history);
    }
}
let globalInProcessA2ATransport = null;
export function getGlobalInProcessA2ATransport() {
    if (!globalInProcessA2ATransport) {
        globalInProcessA2ATransport = new InProcessA2ATransport();
    }
    return globalInProcessA2ATransport;
}
export function resetGlobalInProcessA2ATransport() {
    globalInProcessA2ATransport = null;
}
export function getAgentIdFromCard(card) {
    return String(card.metadata?.agentId || card.name);
}
function isTransportTask(value) {
    return typeof value === 'object' && value !== null && 'status' in value && 'id' in value;
}
//# sourceMappingURL=transport.js.map