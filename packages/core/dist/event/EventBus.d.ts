/**
 * EventBus — 事件总线（基于 Node.js EventEmitter）
 *
 * 职责：
 * - 解耦看板、工作流、会议之间的直接调用
 * - 支持事件的发布/订阅/异步处理
 * - 所有事件处理都是异步的，不会阻塞主流程
 *
 * 设计为单例模式，整个系统共享一个 EventBus 实例。
 */
import type { KanbanEvent, WorkflowEvent, MeetingEvent, DocumentEvent, ExperienceEvent, SystemEvent, EventHandler } from './types.js';
export type AnyEvent = KanbanEvent | WorkflowEvent | MeetingEvent | DocumentEvent | ExperienceEvent | SystemEvent;
/**
 * 事件总线 — 全系统共享的单例
 */
export declare class EventBus {
    private static instance;
    private emitter;
    private handlers;
    private isEnabled;
    private constructor();
    static getInstance(): EventBus;
    /**
     * 重置单例（主要用于测试）
     */
    static reset(): void;
    /**
     * 启用/禁用事件总线
     */
    setEnabled(enabled: boolean): void;
    /**
     * 发布事件
     */
    emit<T extends AnyEvent>(event: T): void;
    /**
     * 订阅事件类型
     */
    on<T extends AnyEvent>(eventType: T['type'] | '*', handler: EventHandler<T>): () => void;
    /**
     * 监听一次（使用 EventEmitter 原生）
     */
    once<T extends AnyEvent>(eventType: T['type'] | '*', listener: (event: T) => void): void;
    /**
     * 移除所有监听器
     */
    removeAllListeners(eventType?: string): void;
    /**
     * 获取已注册的事件类型
     */
    getRegisteredEventTypes(): string[];
    /**
     * 获取处理器数量
     */
    getHandlerCount(eventType: string): number;
}
/**
 * 全局便捷访问函数
 */
export declare const eventBus: EventBus;
//# sourceMappingURL=EventBus.d.ts.map