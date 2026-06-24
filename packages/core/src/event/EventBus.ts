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

import { EventEmitter } from 'events';
import type {
  KanbanEvent,
  WorkflowEvent,
  MeetingEvent,
  SystemEvent,
  EventHandler,
} from './types.js';

export type AnyEvent = KanbanEvent | WorkflowEvent | MeetingEvent | SystemEvent;

/**
 * 事件总线 — 全系统共享的单例
 */
export class EventBus {
  private static instance: EventBus | null = null;
  private emitter: EventEmitter;
  private handlers: Map<string, EventHandler[]> = new Map();
  private isEnabled: boolean = true;

  private constructor() {
    this.emitter = new EventEmitter();
    // 设置最大监听器数量，避免内存泄漏
    this.emitter.setMaxListeners(50);
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * 重置单例（主要用于测试）
   */
  static reset(): void {
    EventBus.instance = null;
  }

  /**
   * 启用/禁用事件总线
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    console.log(`[EventBus] ${enabled ? '已启用' : '已禁用'}`);
  }

  /**
   * 发布事件
   */
  emit<T extends AnyEvent>(event: T): void {
    if (!this.isEnabled) {
      console.warn('[EventBus] 事件总线已禁用，事件被丢弃:', event.type);
      return;
    }

    // 先同步触发 EventEmitter 监听器
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event); // 通配符监听

    // 再异步执行注册的处理函数
    const handlers = this.handlers.get(event.type) || [];
    for (const handler of handlers) {
      // 异步执行，不阻塞
      Promise.resolve().then(() => {
        handler(event).catch((err) => {
          console.error(`[EventBus] 处理器执行失败 (${event.type}):`, err);
        });
      });
    }

    console.log(`[EventBus] 事件已发布: ${event.type} (${event.source})`);
  }

  /**
   * 订阅事件类型
   */
  on<T extends AnyEvent>(
    eventType: T['type'] | '*',
    handler: EventHandler<T>,
  ): () => void {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler as EventHandler);
    this.handlers.set(eventType, handlers);

    // 返回取消订阅函数
    return () => {
      const current = this.handlers.get(eventType) || [];
      const idx = current.indexOf(handler as EventHandler);
      if (idx >= 0) {
        current.splice(idx, 1);
      }
    };
  }

  /**
   * 监听一次（使用 EventEmitter 原生）
   */
  once<T extends AnyEvent>(
    eventType: T['type'] | '*',
    listener: (event: T) => void,
  ): void {
    this.emitter.once(eventType, listener);
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.handlers.delete(eventType);
      this.emitter.removeAllListeners(eventType);
    } else {
      this.handlers.clear();
      this.emitter.removeAllListeners();
    }
  }

  /**
   * 获取已注册的事件类型
   */
  getRegisteredEventTypes(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * 获取处理器数量
   */
  getHandlerCount(eventType: string): number {
    return (this.handlers.get(eventType) || []).length;
  }
}

/**
 * 全局便捷访问函数
 */
export const eventBus = EventBus.getInstance();
