/**
 * send_message 自定义工具
 *
 * 让 Agent 可以通过 MessageBus 与其他 Agent 通信。
 * 基于 Hermes Agent 架构，通过 MessageBus 实现 Agent 间异步通信。
 */
import { z } from 'zod';
import { getGlobalMessageBus } from '../event/MessageBus.js';
export function createSendMessageTool() {
    return {
        name: 'send_message',
        description: '发送消息给同团队的其他 Agent。可以发送给指定 Agent 或广播给所有 Agent。' +
            '可用的团队成员: dev-frontend, dev-backend, dev-testing, dev-devops, dev-pm',
        inputSchema: z.object({
            to: z
                .string()
                .describe('目标 Agent 名称（如 dev-frontend、dev-backend 等），使用 "*" 广播给所有 Agent'),
            content: z.string().describe('消息内容'),
        }),
        execute: async (input, context) => {
            const from = context.agent.name;
            if (input.to === '*') {
                try {
                    const bus = getGlobalMessageBus();
                    await bus.broadcast({
                        from,
                        type: 'chat',
                        content: input.content,
                    });
                }
                catch (err) {
                    console.warn('[send_message] MessageBus 广播失败:', err);
                }
                return { data: `已广播给所有 Agent`, isError: false };
            }
            try {
                const bus = getGlobalMessageBus();
                await bus.send(input.to, {
                    from,
                    to: input.to,
                    type: 'chat',
                    content: input.content,
                });
            }
            catch (err) {
                console.warn('[send_message] MessageBus 发送失败:', err);
            }
            return { data: `已发送给 ${input.to}`, isError: false };
        },
    };
}
//# sourceMappingURL=send-message.js.map