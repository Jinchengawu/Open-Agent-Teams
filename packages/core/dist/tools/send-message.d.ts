/**
 * send_message 自定义工具
 *
 * 让 Agent 可以通过 MessageBus 与其他 Agent 通信。
 * 使用全局 team-registry 获取 Team 实例（打破 createTeam 与 customTools 的循环依赖）。
 */
export declare function createSendMessageTool(teamId: string): import("@open-multi-agent/core").ToolDefinition<{
    to: string;
    content: string;
}>;
//# sourceMappingURL=send-message.d.ts.map