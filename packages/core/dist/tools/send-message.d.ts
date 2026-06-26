/**
 * send_message 自定义工具
 *
 * 让 Agent 可以通过 MessageBus 与其他 Agent 通信。
 * 基于 Hermes Agent 架构，通过 MessageBus 实现 Agent 间异步通信。
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