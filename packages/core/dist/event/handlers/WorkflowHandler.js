/**
 * WorkflowHandler — 工作流事件处理器
 *
 * 处理工作流相关事件，触发联动动作：
 * - workflow.completed: 自动更新看板任务状态为 done
 * - workflow.failed: 自动更新看板任务状态为 blocked
 * - workflow.step_completed: 更新看板进度
 */
import { eventBus } from '../EventBus.js';
/**
 * 注册工作流事件处理器
 */
export function registerWorkflowHandlers(deps = {}) {
    const { updateTaskStatus, updateTaskProgress, getTaskByWorkflowId } = deps;
    // ── 工作流完成 → 更新看板任务状态 ──
    eventBus.on('workflow.completed', async (event) => {
        const { workflowId, taskId, output } = event.payload;
        const targetTaskId = taskId || (await getTaskByWorkflowId?.(workflowId))?.taskId;
        if (!targetTaskId) {
            console.log(`[WorkflowHandler] 工作流 ${workflowId} 未关联看板任务，跳过更新`);
            return;
        }
        console.log(`[WorkflowHandler] 工作流 ${workflowId} 完成，更新任务 ${targetTaskId} → done`);
        try {
            await updateTaskStatus?.(targetTaskId, 'done');
            // 触发看板任务完成事件
            eventBus.emit({
                type: 'kanban.task.completed',
                source: 'kanban',
                timestamp: Date.now(),
                payload: {
                    taskId: targetTaskId,
                    workflowId,
                    metadata: { output: output?.substring(0, 200) },
                },
            });
        }
        catch (err) {
            console.error(`[WorkflowHandler] 更新看板任务状态失败:`, err);
        }
    });
    // ── 工作流失败 → 更新看板任务状态为 blocked ──
    eventBus.on('workflow.failed', async (event) => {
        const { workflowId, taskId, error } = event.payload;
        const targetTaskId = taskId || (await getTaskByWorkflowId?.(workflowId))?.taskId;
        if (!targetTaskId)
            return;
        console.error(`[WorkflowHandler] 工作流 ${workflowId} 失败，更新任务 ${targetTaskId} → blocked`);
        try {
            await updateTaskStatus?.(targetTaskId, 'blocked');
        }
        catch (err) {
            console.error(`[WorkflowHandler] 更新看板任务状态失败:`, err);
        }
    });
    // ── 工作流步骤完成 → 更新进度 ──
    eventBus.on('workflow.step_completed', async (event) => {
        const { workflowId, taskId, stepIndex, totalSteps } = event.payload;
        const targetTaskId = taskId || (await getTaskByWorkflowId?.(workflowId))?.taskId;
        if (!targetTaskId || stepIndex === undefined || totalSteps === undefined)
            return;
        const progress = Math.round(((stepIndex + 1) / totalSteps) * 100);
        console.log(`[WorkflowHandler] 工作流 ${workflowId} 步骤 ${stepIndex + 1}/${totalSteps}，进度 ${progress}%`);
        try {
            await updateTaskProgress?.(targetTaskId, progress);
        }
        catch (err) {
            console.error(`[WorkflowHandler] 更新进度失败:`, err);
        }
    });
    // ── 工作流开始 → 更新看板任务状态为 in_progress ──
    eventBus.on('workflow.started', async (event) => {
        const { workflowId, taskId } = event.payload;
        const targetTaskId = taskId || (await getTaskByWorkflowId?.(workflowId))?.taskId;
        if (!targetTaskId)
            return;
        console.log(`[WorkflowHandler] 工作流 ${workflowId} 开始，更新任务 ${targetTaskId} → in_progress`);
        try {
            await updateTaskStatus?.(targetTaskId, 'in_progress');
        }
        catch (err) {
            console.error(`[WorkflowHandler] 更新看板任务状态失败:`, err);
        }
    });
    console.log('[WorkflowHandler] 工作流事件处理器已注册');
}
//# sourceMappingURL=WorkflowHandler.js.map