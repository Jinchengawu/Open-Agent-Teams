/**
 * send_message 自定义工具
 *
 * 让 Agent 可以通过 A2A transport 与其他 Agent 通信。
 * MessageBus 仅作为旧处理器兼容层保留。
 */
import { z } from 'zod';
import { createA2AMessage, getGlobalInProcessA2ATransport } from '../a2a/index.js';
import { getGlobalMessageBus } from '../event/MessageBus.js';
export function createSendMessageTool() {
    return {
        name: 'send_message',
        description: '发送消息给同团队的其他 Agent。可以发送给指定 Agent 或广播给所有 Agent。' +
            '目标 Agent ID 由当前 Team Profile 定义。',
        inputSchema: z.object({
            to: z
                .string()
                .describe('目标 Agent ID，使用 "*" 广播给所有 Agent'),
            content: z.string().describe('消息内容'),
        }),
        execute: async (input, context) => {
            const from = context.agent.name;
            if (input.to === '*') {
                try {
                    const transport = getGlobalInProcessA2ATransport();
                    await Promise.all(transport.listAgentCards().map((card) => transport.sendMessage(String(card.metadata?.agentId || card.name), {
                        message: createA2AMessage({
                            role: 'agent',
                            text: input.content,
                            metadata: { from, broadcast: true, transport: 'a2a' },
                        }),
                    })));
                }
                catch (err) {
                    console.warn('[send_message] A2A 广播失败，回退 MessageBus:', err);
                    const bus = getGlobalMessageBus();
                    await bus.broadcast({
                        from,
                        type: 'chat',
                        content: input.content,
                    });
                }
                return { data: '已通过 A2A 广播给所有 Agent', isError: false };
            }
            try {
                const transport = getGlobalInProcessA2ATransport();
                await transport.sendMessage(input.to, {
                    message: createA2AMessage({
                        role: 'agent',
                        text: input.content,
                        metadata: { from, to: input.to, transport: 'a2a' },
                    }),
                });
            }
            catch (err) {
                console.warn('[send_message] A2A 发送失败，回退 MessageBus:', err);
                const bus = getGlobalMessageBus();
                await bus.send(input.to, {
                    from,
                    to: input.to,
                    type: 'chat',
                    content: input.content,
                });
            }
            return { data: `已通过 A2A 发送给 ${input.to}`, isError: false };
        },
    };
}
//# sourceMappingURL=send-message.js.map