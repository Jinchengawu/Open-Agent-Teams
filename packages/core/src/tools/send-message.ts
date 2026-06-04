/**
 * send_message 自定义工具
 *
 * 让 Agent 可以通过 MessageBus 与其他 Agent 通信。
 * 使用全局 team-registry 获取 Team 实例（打破 createTeam 与 customTools 的循环依赖）。
 */

import { defineTool } from '@open-multi-agent/core';
import { z } from 'zod';
import { getTeam } from './team-registry.js';

export function createSendMessageTool(teamId: string) {
  return defineTool({
    name: 'send_message',
    description:
      '发送消息给同团队的其他 Agent。可以发送给指定 Agent 或广播给所有 Agent。' +
      '可用的团队成员: dev-frontend, dev-backend, dev-testing, dev-devops, dev-pm',
    inputSchema: z.object({
      to: z
        .string()
        .describe(
          '目标 Agent 名称（如 dev-frontend、dev-backend 等），使用 "*" 广播给所有 Agent',
        ),
      content: z.string().describe('消息内容'),
    }),
    execute: async (input, context) => {
      const team = getTeam(teamId);
      if (!team) {
        return { data: 'Team not found', isError: true };
      }

      const from = context.agent.name;

      if (input.to === '*') {
        team.broadcast(from, input.content);
        return { data: `已广播给所有 Agent`, isError: false };
      }

      team.sendMessage(from, input.to, input.content);
      return { data: `已发送给 ${input.to}`, isError: false };
    },
  });
}
