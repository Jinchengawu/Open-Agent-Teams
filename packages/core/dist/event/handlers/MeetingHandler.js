/**
 * MeetingHandler — 会议事件处理器
 *
 * 处理会议相关事件，触发联动动作：
 * - meeting.completed: 自动解析行动项 → 创建看板任务
 * - meeting.round_completed: 更新进度
 */
import { eventBus } from '../EventBus.js';
/**
 * 注册会议事件处理器
 */
export function registerMeetingHandlers(deps = {}) {
    const { createKanbanTask, saveMeetingDocument } = deps;
    // ── 会议完成 → 自动创建看板任务 ──
    eventBus.on('meeting.completed', async (event) => {
        const { meetingId, summary, actionItems, participants, documentId } = event.payload;
        console.log(`[MeetingHandler] 会议 ${meetingId} 完成，处理行动项`);
        // 1. 保存会议纪要（如果还没有文档）
        if (summary && saveMeetingDocument && !documentId) {
            try {
                const docId = await saveMeetingDocument(meetingId, summary);
                console.log(`[MeetingHandler] 会议纪要已保存: ${docId}`);
            }
            catch (err) {
                console.error(`[MeetingHandler] 保存会议纪要失败:`, err);
            }
        }
        // 2. 自动创建看板任务
        if (actionItems && actionItems.length > 0 && createKanbanTask) {
            for (const item of actionItems) {
                if (!item.autoCreateTask) {
                    console.log(`[MeetingHandler] 行动项 "${item.description}" 标记为不自动创建，跳过`);
                    continue;
                }
                try {
                    const result = await createKanbanTask({
                        title: item.description,
                        description: `来自会议 ${meetingId} 的行动项\n\n优先级: ${item.priority}\n负责人: ${item.assignee || '未指定'}\n截止日期: ${item.dueDate || '未指定'}`,
                        assignee: item.assignee,
                        priority: item.priority,
                        source: 'meeting',
                        meetingId,
                    });
                    console.log(`[MeetingHandler] 已创建看板任务: ${result.taskId} (${item.description})`);
                    // 触发看板任务创建事件
                    eventBus.emit({
                        type: 'kanban.task.created',
                        source: 'kanban',
                        timestamp: Date.now(),
                        payload: {
                            taskId: result.taskId,
                            title: item.description,
                            assignee: item.assignee,
                            meetingId,
                        },
                    });
                }
                catch (err) {
                    console.error(`[MeetingHandler] 创建看板任务失败:`, err);
                }
            }
        }
        // 3. 触发系统通知
        eventBus.emit({
            type: 'system.health_check',
            source: 'system',
            timestamp: Date.now(),
            payload: {
                message: `会议 ${meetingId} 已完成，产生 ${actionItems?.length || 0} 个行动项`,
                severity: 'info',
                metadata: { meetingId, participants },
            },
        });
    });
    // ── 会议轮次完成 → 日志记录 ──
    eventBus.on('meeting.round_completed', async (event) => {
        const { meetingId, round, totalRounds } = event.payload;
        console.log(`[MeetingHandler] 会议 ${meetingId} 轮次 ${round}/${totalRounds} 完成`);
    });
    console.log('[MeetingHandler] 会议事件处理器已注册');
}
//# sourceMappingURL=MeetingHandler.js.map