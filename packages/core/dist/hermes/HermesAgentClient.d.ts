/**
 * Hermes Agent Client
 *
 * 封装 Hermes Agent 的 HTTP API 调用，作为 OpenMultiAgent 的替代。
 * 每个 Hermes 实例运行在独立端口（如 8201-8205），已自带工具、记忆、RAG。
 * 平台层只负责调用，不重复实现单 Agent 能力。
 */
declare module 'yaml' {
    function parse(content: string): any;
}
export interface HermesInstance {
    id: string;
    label: string;
    port: number;
    hermes_port: number;
    tags: string[];
    skills: string[];
    timeout_ms: number;
}
export interface HermesConfig {
    instances: HermesInstance[];
    routing: {
        rules: {
            tags: string[];
            instance: string;
        }[];
        default: string;
    };
}
export interface HermesAgentResult {
    success: boolean;
    output: string;
    messages: {
        role: string;
        content: string;
    }[];
    tokenUsage: {
        input_tokens: number;
        output_tokens: number;
    };
    toolCalls: {
        toolName: string;
        result?: string;
    }[];
}
export declare class HermesAgentClient {
    private config;
    private instanceMap;
    constructor(config?: HermesConfig);
    /**
     * 获取所有实例列表
     */
    getInstances(): HermesInstance[];
    /**
     * 获取指定实例配置
     */
    getInstance(agentId: string): HermesInstance | undefined;
    /**
     * 调用单个 Hermes Agent 实例
     *
     * 通过 HTTP POST 到 Hermes 的 /v1/chat/completions 端点
     */
    callAgent(agentId: string, goal: string, options?: {
        systemPrompt?: string;
        maxTokens?: number;
        sessionId?: string;
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<HermesAgentResult>;
    /**
     * 批量调用多个 Agent（并行）
     */
    callAgents(agentIds: string[], goal: string, options?: {
        systemPrompt?: string;
        maxTokens?: number;
    }): Promise<Map<string, HermesAgentResult>>;
    /**
     * 检查 Agent 实例是否在线
     */
    healthCheck(agentId: string, timeoutMs?: number): Promise<{
        online: boolean;
        latency: number;
    }>;
    /**
     * 检查所有实例状态
     */
    healthCheckAll(timeoutMs?: number): Promise<Map<string, {
        online: boolean;
        latency: number;
    }>>;
}
/**
 * 创建 Hermes Agent Client（便捷工厂）
 */
export declare function createHermesAgentClient(config?: HermesConfig): HermesAgentClient;
export declare function getGlobalHermesClient(): HermesAgentClient;
//# sourceMappingURL=HermesAgentClient.d.ts.map