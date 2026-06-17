/**
 * 结构化事件日志
 *
 * 记录系统运行事件，支持后续集成 Langfuse 或自建 Telemetry。
 */

/** 事件类型 */
export type EventType =
  | 'agent_start'
  | 'agent_end'
  | 'agent_error'
  | 'task_start'
  | 'task_end'
  | 'task_error'
  | 'meeting_start'
  | 'meeting_end'
  | 'meeting_comment'
  | 'token_usage'
  | 'system_health'
  | 'custom';

/** 事件严重级别 */
export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

/** 结构化事件 */
export interface TelemetryEvent {
  id: string;
  type: EventType;
  level: EventLevel;
  timestamp: string;
  source: string; // agentId 或 'system'
  message: string;
  metadata: Record<string, unknown>;
  duration?: number;
  tokens?: number;
  cost?: number;
}

/** 事件处理器 */
export type EventHandler = (event: TelemetryEvent) => void;

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private globalHandlers: EventHandler[] = [];

  /** 注册全局事件处理器 */
  onGlobal(handler: EventHandler): void {
    this.globalHandlers.push(handler);
  }

  /** 注册特定类型事件处理器 */
  on(type: EventType, handler: EventHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  /** 移除处理器 */
  off(type: EventType, handler: EventHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    }
  }

  /** 发送事件 */
  emit(event: TelemetryEvent): void {
    // 全局处理器
    for (const handler of this.globalHandlers) {
      try { handler(event); } catch { /* 忽略处理器错误 */ }
    }

    // 类型处理器
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(event); } catch { /* 忽略处理器错误 */ }
      }
    }
  }

  /** 清理 */
  destroy(): void {
    this.handlers.clear();
    this.globalHandlers = [];
  }
}

/** 事件 ID 生成 */
let eventIdCounter = 0;
export function generateEventId(): string {
  return `evt-${Date.now()}-${++eventIdCounter}`;
}

/** 创建事件 */
export function createEvent(
  type: EventType,
  source: string,
  message: string,
  metadata: Record<string, unknown> = {},
  level: EventLevel = 'info'
): TelemetryEvent {
  return {
    id: generateEventId(),
    type,
    level,
    timestamp: new Date().toISOString(),
    source,
    message,
    metadata,
  };
}
