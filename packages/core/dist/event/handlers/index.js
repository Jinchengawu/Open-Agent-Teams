/**
 * Event Handlers — 事件处理器注册入口
 *
 * 用法：
 *   import { registerAllHandlers } from '@open-agent-teams/core/event/handlers';
 *   registerAllHandlers({
 *     kanban: { runWorkflow: async (taskId, goal) => { ... } },
 *     workflow: { updateTaskStatus: async (taskId, status) => { ... } },
 *     meeting: { createKanbanTask: async (task) => { ... } },
 *   });
 */
import { registerKanbanHandlers } from './KanbanHandler.js';
import { registerWorkflowHandlers } from './WorkflowHandler.js';
import { registerMeetingHandlers } from './MeetingHandler.js';
/**
 * 注册所有事件处理器
 */
export function registerAllHandlers(deps = {}) {
    registerKanbanHandlers(deps.kanban);
    registerWorkflowHandlers(deps.workflow);
    registerMeetingHandlers(deps.meeting);
    console.log('[EventHandlers] 所有事件处理器已注册完成');
}
export { registerKanbanHandlers };
export { registerWorkflowHandlers };
export { registerMeetingHandlers };
//# sourceMappingURL=index.js.map