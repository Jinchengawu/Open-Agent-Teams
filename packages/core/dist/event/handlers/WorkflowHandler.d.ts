/**
 * WorkflowHandler — 工作流事件处理器
 *
 * 处理工作流相关事件，触发联动动作：
 * - workflow.completed: 自动更新看板任务状态为 done
 * - workflow.failed: 自动更新看板任务状态为 blocked
 * - workflow.step_completed: 更新看板进度
 */
export interface WorkflowHandlerDeps {
    /** 更新看板任务状态 */
    updateTaskStatus?: (taskId: string, status: string) => Promise<void>;
    /** 更新看板任务进度 */
    updateTaskProgress?: (taskId: string, progress: number) => Promise<void>;
    /** 获取任务绑定的看板任务 */
    getTaskByWorkflowId?: (workflowId: string) => Promise<{
        taskId: string;
    } | null>;
}
/**
 * 注册工作流事件处理器
 */
export declare function registerWorkflowHandlers(deps?: WorkflowHandlerDeps): void;
//# sourceMappingURL=WorkflowHandler.d.ts.map