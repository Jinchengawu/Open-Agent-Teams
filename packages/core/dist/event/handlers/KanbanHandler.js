/**
 * KanbanHandler — 看板事件处理器
 *
 * 处理看板相关事件，触发联动动作：
 * - task.status_changed → in_progress: 触发绑定的工作流
 * - task.completed: 触发下游通知
 * - task.created: 自动分配最佳 Agent（通过 IntentRouter）
 */
import { eventBus } from '../EventBus.js';
/**
 * 注册看板事件处理器
 */
export function registerKanbanHandlers(deps = {}) {
    const { runWorkflow, getTask, assignTask } = deps;
    // ── 看板任务状态变更 → 触发工作流 ──
    eventBus.on('kanban.task.status_changed', async (event) => {
        const { taskId, status, oldStatus, workflowId } = event.payload;
        console.log(`[KanbanHandler] 任务 ${taskId} 状态变更: ${oldStatus} → ${status}`);
        // 状态变为 in_progress → 自动触发工作流
        if (status === 'in_progress' && oldStatus !== 'in_progress') {
            if (workflowId && runWorkflow) {
                console.log(`[KanbanHandler] 触发工作流 ${workflowId} 执行`);
                try {
                    const task = await getTask?.(taskId);
                    const goal = task?.title || `执行任务 ${taskId}`;
                    await runWorkflow(taskId, goal);
                }
                catch (err) {
                    console.error(`[KanbanHandler] 触发工作流失败:`, err);
                }
            }
            else {
                console.log(`[KanbanHandler] 任务 ${taskId} 未绑定工作流，跳过自动触发`);
            }
        }
        // 状态变为 done → 触发完成事件
        if (status === 'done' && oldStatus !== 'done') {
            console.log(`[KanbanHandler] 任务 ${taskId} 已完成`);
            // 可以在这里触发下游通知、归档等
        }
        // 状态变为 blocked → 触发异常处理
        if (status === 'blocked') {
            console.warn(`[KanbanHandler] 任务 ${taskId} 被阻塞`);
            eventBus.emit({
                type: 'system.agent.error',
                source: 'system',
                timestamp: Date.now(),
                payload: {
                    message: `任务 ${taskId} 被阻塞`,
                    severity: 'warning',
                    metadata: { taskId, oldStatus },
                },
            });
        }
    });
    // ── 看板任务创建 → 自动分配 Agent ──
    eventBus.on('kanban.task.created', async (event) => {
        const { taskId, title, assignee } = event.payload;
        console.log(`[KanbanHandler] 新任务创建: ${taskId} - ${title}`);
        // 如果没有指定负责人，可以自动分配（需要 IntentRouter 支持）
        if (!assignee && assignTask) {
            console.log(`[KanbanHandler] 任务 ${taskId} 未指定负责人，准备自动分配`);
            // 实际分配逻辑由调用方注入（通过 IntentRouter 决策）
            // 这里只做事件触发
        }
    });
    console.log('[KanbanHandler] 看板事件处理器已注册');
}
//# sourceMappingURL=KanbanHandler.js.map