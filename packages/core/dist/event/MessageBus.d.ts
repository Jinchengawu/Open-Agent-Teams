/**
 * MessageBus — 轻量级 Agent 间异步消息总线
 *
 * 基于 Node.js EventEmitter 实现，无需额外服务器（NATS/Redis）。
 * 每个 Agent 独立订阅自己的主题，实现真正的异步并行通信。
 *
 * 当前版本为进程内总线，后续可替换为 NATS/Redis 而不改接口。
 */
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
export declare class MessageBus {
    private emitter;
    private agentHandlers;
    private messageHistory;
    private options;
    constructor(options?: MessageBusOptions);
    /**
     * Agent 注册自己的消息处理器
     */
    registerAgent(agentId: string, handler: (msg: AgentMessage) => Promise<void>): () => void;
    /**
     * 发送消息给指定 Agent（异步，不阻塞）
     * 别名: sendMessage
     */
    send(to: string, message: Omit<AgentMessage, 'id' | 'metadata'> & {
        metadata?: Partial<AgentMessage['metadata']>;
    }): Promise<void>;
    sendMessage: (to: string, message: Omit<AgentMessage, "id" | "metadata"> & {
        metadata?: Partial<AgentMessage["metadata"]>;
    }) => Promise<void>;
    /**
     * A2A-compatible send.
     *
     * MessageBus is an in-process transport. The protocol semantics are carried
     * by A2AMessage, then adapted to the legacy handler shape until handlers are
     * fully migrated.
     */
    sendA2AMessage(to: string, message: A2AMessage, from?: string): Promise<void>;
    /**
     * 广播消息给所有 Agent（异步并行）
     */
    broadcast(message: Omit<AgentMessage, 'id' | 'to' | 'metadata'> & {
        metadata?: Partial<AgentMessage['metadata']>;
    }): Promise<void>;
    broadcastA2AMessage(message: A2AMessage, from?: string): Promise<void>;
    /**
     * 请求-响应模式（同步等待）
     */
    request(to: string, message: Omit<AgentMessage, 'id' | 'to' | 'metadata'> & {
        metadata?: Partial<AgentMessage['metadata']>;
    }): Promise<string>;
    /**
     * 发送响应（配合 request 使用）
     */
    respond(correlationId: string, content: string, from: string): void;
    /**
     * 获取已注册的 Agent 列表
     */
    getRegisteredAgents(): string[];
    /**
     * 获取 Agent 处理器数量
     */
    getHandlerCount(agentId: string): number;
    /**
     * 获取 Agent 的消息历史
     */
    getHistory(agentId: string): AgentMessage[];
    getA2AHistory(agentId: string): A2AMessage[];
    /**
     * 清空所有注册
     */
    clear(): void;
}
export declare function getGlobalMessageBus(options?: MessageBusOptions): MessageBus;
export declare function resetGlobalMessageBus(): void;
//# sourceMappingURL=MessageBus.d.ts.map