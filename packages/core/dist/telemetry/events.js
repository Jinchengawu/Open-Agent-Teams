/**
 * 结构化事件日志
 *
 * 记录系统运行事件，支持后续集成 Langfuse 或自建 Telemetry。
 */
export class EventBus {
    handlers = new Map();
    globalHandlers = [];
    /** 注册全局事件处理器 */
    onGlobal(handler) {
        this.globalHandlers.push(handler);
    }
    /** 注册特定类型事件处理器 */
    on(type, handler) {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, []);
        }
        this.handlers.get(type).push(handler);
    }
    /** 移除处理器 */
    off(type, handler) {
        const handlers = this.handlers.get(type);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index >= 0)
                handlers.splice(index, 1);
        }
    }
    /** 发送事件 */
    emit(event) {
        // 全局处理器
        for (const handler of this.globalHandlers) {
            try {
                handler(event);
            }
            catch { /* 忽略处理器错误 */ }
        }
        // 类型处理器
        const handlers = this.handlers.get(event.type);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(event);
                }
                catch { /* 忽略处理器错误 */ }
            }
        }
    }
    /** 清理 */
    destroy() {
        this.handlers.clear();
        this.globalHandlers = [];
    }
}
/** 事件 ID 生成 */
let eventIdCounter = 0;
export function generateEventId() {
    return `evt-${Date.now()}-${++eventIdCounter}`;
}
/** 创建事件 */
export function createEvent(type, source, message, metadata = {}, level = 'info') {
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
//# sourceMappingURL=events.js.map