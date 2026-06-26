/**
 * KanbanHandler — 看板事件处理器
 *
 * 处理看板相关事件，触发联动动作：
 * - task.status_changed → in_progress: 触发绑定的工作流
 * - task.completed: 触发下游通知
 * - task.created: 自动分配最佳 Agent（通过 IntentRouter）
 */
export interface KanbanHandlerDeps {
    /** 触发工作流执行 */
    runWorkflow?: (taskId: string, goal: string) => Promise<void>;
    /** 获取任务详情 */
    getTask?: (taskId: string) => Promise<{
        title: string;
        description: string;
        assignee?: string;
    } | null>;
    /** 分配任务给 Agent */
    assignTask?: (taskId: string, agentId: string) => Promise<void>;
}
/**
 * 注册看板事件处理器
 */
export declare function registerKanbanHandlers(deps?: KanbanHandlerDeps): void;
//# sourceMappingURL=KanbanHandler.d.ts.map