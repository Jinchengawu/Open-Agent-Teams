/**
 * MessageBus — 轻量级 Agent 间异步消息总线
 *
 * 基于 Node.js EventEmitter 实现，无需额外服务器（NATS/Redis）。
 * 每个 Agent 独立订阅自己的主题，实现真正的异步并行通信。
 *
 * 当前版本为进程内总线，后续可替换为 NATS/Redis 而不改接口。
 */
import { EventEmitter } from 'events';
import { a2aMessageToAgentMessage, agentMessageToA2AMessage } from '../a2a/converters.js';
/**
 * 轻量级消息总线 — 基于 EventEmitter
 */
export class MessageBus {
    emitter;
    agentHandlers = new Map();
    messageHistory = new Map();
    options;
    constructor(options = {}) {
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
    registerAgent(agentId, handler) {
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
    async send(to, message) {
        const msg = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            ...message,
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
        await Promise.all(handlers.map((handler) => Promise.race([
            handler(msg),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`消息超时: ${to}`)), this.options.messageTimeout)),
        ]).catch((err) => {
            console.error(`[MessageBus] 发送给 ${to} 失败:`, err);
        })));
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
    async sendA2AMessage(to, message, from = 'team-orchestrator') {
        await this.send(to, a2aMessageToAgentMessage(message, { from, to }));
    }
    /**
     * 广播消息给所有 Agent（异步并行）
     */
    async broadcast(message) {
        const allAgentIds = [...this.agentHandlers.keys()];
        if (this.options.verbose) {
            console.log(`[MessageBus] 广播给 ${allAgentIds.length} 个 Agent: ${allAgentIds.join(', ')}`);
        }
        // 并行发送给所有 Agent（真正的异步广播）
        await Promise.all(allAgentIds.map((agentId) => this.send(agentId, { ...message, to: agentId }).catch((err) => {
            console.error(`[MessageBus] 广播给 ${agentId} 失败:`, err);
        })));
    }
    async broadcastA2AMessage(message, from = 'team-orchestrator') {
        await this.broadcast(a2aMessageToAgentMessage(message, { from, to: 'broadcast' }));
    }
    /**
     * 请求-响应模式（同步等待）
     */
    async request(to, message) {
        const correlationId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.emitter.off(correlationId, onResponse);
                reject(new Error(`请求超时: ${to}`));
            }, this.options.messageTimeout);
            const onResponse = (response) => {
                clearTimeout(timeout);
                this.emitter.off(correlationId, onResponse);
                resolve(response.content);
            };
            this.emitter.once(correlationId, onResponse);
            // 发送请求
            this.send(to, {
                ...message,
                to,
                metadata: { ...message.metadata, correlationId },
            }).catch(reject);
        });
    }
    /**
     * 发送响应（配合 request 使用）
     */
    respond(correlationId, content, from) {
        this.emitter.emit(correlationId, { content, from });
    }
    /**
     * 获取已注册的 Agent 列表
     */
    getRegisteredAgents() {
        return [...this.agentHandlers.keys()];
    }
    /**
     * 获取 Agent 处理器数量
     */
    getHandlerCount(agentId) {
        return (this.agentHandlers.get(agentId) || []).length;
    }
    /**
     * 获取 Agent 的消息历史
     */
    getHistory(agentId) {
        return this.messageHistory.get(agentId) || [];
    }
    getA2AHistory(agentId) {
        return this.getHistory(agentId).map((message) => agentMessageToA2AMessage(message));
    }
    /**
     * 清空所有注册
     */
    clear() {
        this.agentHandlers.clear();
        this.messageHistory.clear();
        this.emitter.removeAllListeners();
    }
}
/**
 * 全局单例（可选）
 */
let globalMessageBus = null;
export function getGlobalMessageBus(options) {
    if (!globalMessageBus) {
        globalMessageBus = new MessageBus(options);
    }
    return globalMessageBus;
}
export function resetGlobalMessageBus() {
    globalMessageBus = null;
}
//# sourceMappingURL=MessageBus.js.map