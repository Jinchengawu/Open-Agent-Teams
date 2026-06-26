/**
 * MeetingHandler — 会议事件处理器
 *
 * 处理会议相关事件，触发联动动作：
 * - meeting.completed: 自动解析行动项 → 创建看板任务
 * - meeting.round_completed: 更新进度
 */
export interface MeetingHandlerDeps {
    /** 在看板中创建任务 */
    createKanbanTask?: (task: {
        title: string;
        description: string;
        assignee?: string;
        priority: 'high' | 'medium' | 'low';
        projectId?: string;
        source: 'meeting';
        meetingId: string;
    }) => Promise<{
        taskId: string;
    }>;
    /** 保存会议纪要文档 */
    saveMeetingDocument?: (meetingId: string, content: string) => Promise<string>;
}
/**
 * 注册会议事件处理器
 */
export declare function registerMeetingHandlers(deps?: MeetingHandlerDeps): void;
//# sourceMappingURL=MeetingHandler.d.ts.map