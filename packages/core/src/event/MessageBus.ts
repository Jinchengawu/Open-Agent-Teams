/**
 * MessageBus — 轻量级 Agent 间异步消息总线
 *
 * 基于 Node.js EventEmitter 实现，无需额外服务器（NATS/Redis）。
 * 每个 Agent 独立订阅自己的主题，实现真正的异步并行通信。
 *
 * 当前版本为进程内总线，后续可替换为 NATS/Redis 而不改接口。
 */

import { EventEmitter } from 'events';
import type { KanbanEvent, WorkflowEvent, MeetingEvent, SystemEvent } from '../event/types.js';
import { a2aMessageToAgentMessage, agentMessageToA2AMessage } from '../a2a/converters.js';
import type { A2AMessage } from '../a2a/types.js';

export interface AgentMessage {
  id: string;
  from: string;
  to: string | 'broadcast';
  type: 'chat' | 'tool_call' | 'task_assign' | 'status_update' | 'meeting_round';
  content: string;
  metadata: {
    sessionId: string;
    timestamp: number;
    correlationId: string;
    round?: number;
  };
}

export interface MessageBusOptions {
  /** 最大并发处理数 */
  maxConcurrency?: number;
  /** 消息超时（ms） */
  messageTimeout?: number;
  /** 是否启用日志 */
  verbose?: boolean;
}

/**
 * 轻量级消息总线 — 基于 EventEmitter
 */
export class MessageBus {
  private emitter: EventEmitter;
  private agentHandlers: Map<string, ((msg: AgentMessage) => Promise<void>)[]> = new Map();
  private messageHistory: Map<string, AgentMessage[]> = new Map();
  private options: Required<MessageBusOptions>;

  constructor(options: MessageBusOptions = {}) {
    this.options = {
      maxConcurrency: 5,
      messageTimeout: 30000,
      verbose: false,
      ...options,
    };
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  /**
   * Agent 注册自己的消息处理器
   */
  registerAgent(agentId: string, handler: (msg: AgentMessage) => Promise<void>): () => void {
    const handlers = this.agentHandlers.get(agentId) || [];
    handlers.push(handler);
    this.agentHandlers.set(agentId, handlers);

    if (this.options.verbose) {
      console.log(`[MessageBus] Agent ${agentId} 已注册`);
    }

    // 返回取消注册函数
    return () => {
      const current = this.agentHandlers.get(agentId) || [];
      const idx = current.indexOf(handler);
      if (idx >= 0) {
        current.splice(idx, 1);
      }
      if (current.length === 0) {
        this.agentHandlers.delete(agentId);
      }
    };
  }

  /**
   * 发送消息给指定 Agent（异步，不阻塞）
   * 别名: sendMessage
   */
  async send(to: string, message: Omit<AgentMessage, 'id' | 'metadata'> & { metadata?: Partial<AgentMessage['metadata']> }): Promise<void> {
    const msg: AgentMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...message as any,
      metadata: {
        sessionId: message.metadata?.sessionId || 'default',
        timestamp: Date.now(),
        correlationId: message.metadata?.correlationId || `corr-${Date.now()}`,
        round: message.metadata?.round,
      },
    };

    // 记录消息历史
    const history = this.messageHistory.get(to) || [];
    history.push(msg);
    this.messageHistory.set(to, history);

    const handlers = this.agentHandlers.get(to);
    if (!handlers || handlers.length === 0) {
      console.warn(`[MessageBus] Agent ${to} 未注册，消息被丢弃`);
      return;
    }

    // 异步执行所有处理器（并行）
    await Promise.all(handlers.map((handler) =>
      Promise.race([
        handler(msg),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`消息超时: ${to}`)), this.options.messageTimeout)
        ),
      ]).catch((err) => {
        console.error(`[MessageBus] 发送给 ${to} 失败:`, err);
      })
    ));
  }

  // 别名：sendMessage 兼容旧版 API
  sendMessage = this.send.bind(this);

  /**
   * A2A-compatible send.
   *
   * MessageBus is an in-process transport. The protocol semantics are carried
   * by A2AMessage, then adapted to the legacy handler shape until handlers are
   * fully migrated.
   */
  async sendA2AMessage(to: string, message: A2AMessage, from = 'team-orchestrator'): Promise<void> {
    await this.send(to, a2aMessageToAgentMessage(message, { from, to }));
  }

  /**
   * 广播消息给所有 Agent（异步并行）
   */
  async broadcast(message: Omit<AgentMessage, 'id' | 'to' | 'metadata'> & { metadata?: Partial<AgentMessage['metadata']> }): Promise<void> {
    const allAgentIds = [...this.agentHandlers.keys()];
    
    if (this.options.verbose) {
      console.log(`[MessageBus] 广播给 ${allAgentIds.length} 个 Agent: ${allAgentIds.join(', ')}`);
    }

    // 并行发送给所有 Agent（真正的异步广播）
    await Promise.all(
      allAgentIds.map((agentId) =>
        this.send(agentId, { ...message as any, to: agentId }).catch((err) => {
          console.error(`[MessageBus] 广播给 ${agentId} 失败:`, err);
        })
      )
    );
  }

  async broadcastA2AMessage(message: A2AMessage, from = 'team-orchestrator'): Promise<void> {
    await this.broadcast(a2aMessageToAgentMessage(message, { from, to: 'broadcast' }));
  }

  /**
   * 请求-响应模式（同步等待）
   */
  async request(to: string, message: Omit<AgentMessage, 'id' | 'to' | 'metadata'> & { metadata?: Partial<AgentMessage['metadata']> }): Promise<string> {
    const correlationId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.emitter.off(correlationId, onResponse);
        reject(new Error(`请求超时: ${to}`));
      }, this.options.messageTimeout);

      const onResponse = (response: { content: string; from: string }) => {
        clearTimeout(timeout);
        this.emitter.off(correlationId, onResponse);
        resolve(response.content);
      };

      this.emitter.once(correlationId, onResponse);

      // 发送请求
      this.send(to, {
        ...message as any,
        to,
        metadata: { ...message.metadata, correlationId },
      }).catch(reject);
    });
  }

  /**
   * 发送响应（配合 request 使用）
   */
  respond(correlationId: string, content: string, from: string): void {
    this.emitter.emit(correlationId, { content, from });
  }

  /**
   * 获取已注册的 Agent 列表
   */
  getRegisteredAgents(): string[] {
    return [...this.agentHandlers.keys()];
  }

  /**
   * 获取 Agent 处理器数量
   */
  getHandlerCount(agentId: string): number {
    return (this.agentHandlers.get(agentId) || []).length;
  }

  /**
   * 获取 Agent 的消息历史
   */
  getHistory(agentId: string): AgentMessage[] {
    return this.messageHistory.get(agentId) || [];
  }

  getA2AHistory(agentId: string): A2AMessage[] {
    return this.getHistory(agentId).map((message) => agentMessageToA2AMessage(message));
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    this.agentHandlers.clear();
    this.messageHistory.clear();
    this.emitter.removeAllListeners();
  }
}

/**
 * 全局单例（可选）
 */
let globalMessageBus: MessageBus | null = null;

export function getGlobalMessageBus(options?: MessageBusOptions): MessageBus {
  if (!globalMessageBus) {
    globalMessageBus = new MessageBus(options);
  }
  return globalMessageBus;
}

export function resetGlobalMessageBus(): void {
  globalMessageBus = null;
}
