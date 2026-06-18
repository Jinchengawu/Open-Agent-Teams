/**
 * 结构化事件日志
 *
 * 记录系统运行事件，支持后续集成 Langfuse 或自建 Telemetry。
 */
/** 事件类型 */
export type EventType = 'agent_start' | 'agent_end' | 'agent_error' | 'task_start' | 'task_end' | 'task_error' | 'meeting_start' | 'meeting_end' | 'meeting_comment' | 'token_usage' | 'system_health' | 'custom';
/** 事件严重级别 */
export type EventLevel = 'debug' | 'info' | 'warn' | 'error';
/** 结构化事件 */
export interface TelemetryEvent {
    id: string;
    type: EventType;
    level: EventLevel;
    timestamp: string;
    source: string;
    message: string;
    metadata: Record<string, unknown>;
    duration?: number;
    tokens?: number;
    cost?: number;
}
/** 事件处理器 */
export type EventHandler = (event: TelemetryEvent) => void;
export declare class EventBus {
    private handlers;
    private globalHandlers;
    /** 注册全局事件处理器 */
    onGlobal(handler: EventHandler): void;
    /** 注册特定类型事件处理器 */
    on(type: EventType, handler: EventHandler): void;
    /** 移除处理器 */
    off(type: EventType, handler: EventHandler): void;
    /** 发送事件 */
    emit(event: TelemetryEvent): void;
    /** 清理 */
    destroy(): void;
}
export declare function generateEventId(): string;
/** 创建事件 */
export declare function createEvent(type: EventType, source: string, message: string, metadata?: Record<string, unknown>, level?: EventLevel): TelemetryEvent;
//# sourceMappingURL=events.d.ts.map