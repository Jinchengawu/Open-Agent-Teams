/**
 * send_message 自定义工具
 *
 * 让 Agent 可以通过 A2A transport 与其他 Agent 通信。
 * MessageBus 仅作为旧处理器兼容层保留。
 */
import { z } from 'zod';
export declare function createSendMessageTool(): {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        to: z.ZodString;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        to: string;
        content: string;
    }, {
        to: string;
        content: string;
    }>;
    execute: (input: {
        to: string;
        content: string;
    }, context: {
        agent: {
            name: string;
        };
    }) => Promise<{
        data: string;
        isError: boolean;
    }>;
};
//# sourceMappingURL=send-message.d.ts.map