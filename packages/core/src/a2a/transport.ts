import { EventEmitter } from 'events';
import type {
  A2AAgentCard,
  A2AMessage,
  A2ASendMessageRequest,
  A2ASendMessageResult,
  A2ATask,
} from './types.js';
import { createA2AMessage } from './converters.js';
import type { A2AHistoryStore } from './history-store.js';

export interface A2ATransportHandler {
  agentCard: A2AAgentCard;
  handleMessage: (request: A2ASendMessageRequest) => Promise<A2ASendMessageResult>;
}

export interface A2ATransport {
  registerAgent(card: A2AAgentCard, handler: A2ATransportHandler['handleMessage']): () => void;
  getAgentCard(agentId: string): A2AAgentCard | undefined;
  listAgentCards(): A2AAgentCard[];
  sendMessage(toAgentId: string, request: A2ASendMessageRequest): Promise<A2ASendMessageResult>;
  getMessageHistory(agentId: string): A2AMessage[];
  getTaskHistory(agentId: string): A2ATask[];
}

export class InProcessA2ATransport implements A2ATransport {
  private handlers = new Map<string, A2ATransportHandler>();
  private messageHistory = new Map<string, A2AMessage[]>();
  private taskHistory = new Map<string, A2ATask[]>();
  private emitter = new EventEmitter();
  private historyStore?: A2AHistoryStore;

  setHistoryStore(store: A2AHistoryStore): void {
    this.historyStore = store;
  }

  registerAgent(card: A2AAgentCard, handler: A2ATransportHandler['handleMessage']): () => void {
    const agentId = getAgentIdFromCard(card);
    this.handlers.set(agentId, { agentCard: card, handleMessage: handler });
    this.emitter.emit('agent.registered', card);

    return () => {
      this.handlers.delete(agentId);
      this.emitter.emit('agent.unregistered', card);
    };
  }

  getAgentCard(agentId: string): A2AAgentCard | undefined {
    return this.handlers.get(agentId)?.agentCard;
  }

  listAgentCards(): A2AAgentCard[] {
    return Array.from(this.handlers.values()).map((handler) => handler.agentCard);
  }

  async sendMessage(toAgentId: string, request: A2ASendMessageRequest): Promise<A2ASendMessageResult> {
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
        for (const historyMessage of result.history) this.appendMessage(toAgentId, historyMessage);
      }
    } else {
      this.appendMessage(toAgentId, result);
    }

    return result;
  }

  getMessageHistory(agentId: string): A2AMessage[] {
    if (this.historyStore) return this.historyStore.getMessageHistory(agentId);
    return this.messageHistory.get(agentId) || [];
  }

  getTaskHistory(agentId: string): A2ATask[] {
    if (this.historyStore) return this.historyStore.getTaskHistory(agentId);
    return this.taskHistory.get(agentId) || [];
  }

  private appendMessage(agentId: string, message: A2AMessage): void {
    const history = this.messageHistory.get(agentId) || [];
    history.push(message);
    this.messageHistory.set(agentId, history);
    this.historyStore?.appendMessage(agentId, message);
  }

  private appendTask(agentId: string, task: A2ATask): void {
    const history = this.taskHistory.get(agentId) || [];
    history.push(task);
    this.taskHistory.set(agentId, history);
    this.historyStore?.appendTask(agentId, task);
  }
}

let globalInProcessA2ATransport: InProcessA2ATransport | null = null;

export function getGlobalInProcessA2ATransport(): InProcessA2ATransport {
  if (!globalInProcessA2ATransport) {
    globalInProcessA2ATransport = new InProcessA2ATransport();
  }
  return globalInProcessA2ATransport;
}

export function resetGlobalInProcessA2ATransport(): void {
  globalInProcessA2ATransport = null;
}

export function getAgentIdFromCard(card: A2AAgentCard): string {
  return String(card.metadata?.agentId || card.name);
}

function isTransportTask(value: A2ASendMessageResult): value is A2ATask {
  return typeof value === 'object' && value !== null && 'status' in value && 'id' in value;
}
