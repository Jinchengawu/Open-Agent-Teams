/**
 * Hermes Agent Client
 *
 * 封装 Hermes Agent 的 HTTP API 调用，作为 OpenMultiAgent 的替代。
 * 每个 Hermes 实例运行在独立端口（如 8201-8205），已自带工具、记忆、RAG。
 * 平台层只负责调用，不重复实现单 Agent 能力。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OPEN_FRAMEWORK_TEAM_PROFILE } from '../team-profile/open-framework-profile.js';
import { createA2AMessage, partsToText } from '../a2a/converters.js';
import { parse as parseYaml } from 'yaml';
// ============================================================================
// Configuration Loader
// ============================================================================
const CONFIG_PATHS = [
    join(process.cwd(), 'config/oma/instances.yaml'),
    join(process.cwd(), '../config/oma/instances.yaml'),
    join(process.cwd(), '../../config/oma/instances.yaml'),
];
function loadConfig() {
    for (const path of CONFIG_PATHS) {
        if (existsSync(path)) {
            try {
                const content = readFileSync(path, 'utf-8');
                return parseYaml(content);
            }
            catch (error) {
                console.warn(`[HermesClient] 加载配置失败: ${path}`, error);
            }
        }
    }
    return OPEN_FRAMEWORK_TEAM_PROFILE.hermes;
}
// ============================================================================
// Hermes Agent Client
// ============================================================================
export class HermesAgentClient {
    config;
    instanceMap;
    constructor(config) {
        this.config = config || loadConfig();
        this.instanceMap = new Map();
        for (const inst of this.config.instances) {
            this.instanceMap.set(inst.id, inst);
        }
    }
    /**
     * 获取所有实例列表
     */
    getInstances() {
        return this.config.instances;
    }
    /**
     * 获取指定实例配置
     */
    getInstance(agentId) {
        return this.instanceMap.get(agentId);
    }
    /**
     * 调用单个 Hermes Agent 实例
     *
     * 通过 HTTP POST 到 Hermes 的 /v1/chat/completions 端点
     */
    async callAgent(agentId, goal, options) {
        const instance = this.instanceMap.get(agentId);
        if (!instance) {
            throw new Error(`Hermes 实例 "${agentId}" 未找到。可用实例: ${Array.from(this.instanceMap.keys()).join(', ')}`);
        }
        const port = instance.hermes_port || instance.port;
        const url = `http://127.0.0.1:${port}/v1/chat/completions`;
        const messages = [
            { role: 'system', content: options?.systemPrompt || `你是 ${instance.label}。` },
            { role: 'user', content: goal },
        ];
        const requestBody = {
            model: 'hermes-agent',
            messages: messages, // ← 发送完整的 messages（含 system prompt）
            max_tokens: options?.maxTokens || 4000,
            stream: false,
        };
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer open-agent-teams-key',
        };
        if (options?.sessionId) {
            headers['X-Hermes-Session-Id'] = options.sessionId;
        }
        const startTime = Date.now();
        console.log(`[HermesClient] 调用 ${agentId} @ ${url} → "${goal.substring(0, 60)}..."`);
        const controller = new AbortController();
        const timeoutMs = options?.timeoutMs ?? instance.timeout_ms ?? 120000;
        const timeout = setTimeout(() => controller.abort(new Error(`Hermes request timed out after ${timeoutMs}ms`)), timeoutMs);
        const onAbort = () => controller.abort(options?.signal?.reason || new Error('Hermes request cancelled'));
        if (options?.signal?.aborted) {
            onAbort();
        }
        else {
            options?.signal?.addEventListener('abort', onAbort, { once: true });
        }
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => '未知错误');
                throw new Error(`Hermes HTTP ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            const latency = Date.now() - startTime;
            console.log(`[HermesClient] ${agentId} 响应完成 (${latency}ms)`);
            return {
                success: true,
                output: content,
                messages: [
                    ...messages,
                    { role: 'assistant', content },
                ],
                tokenUsage: {
                    input_tokens: data.usage?.prompt_tokens || 0,
                    output_tokens: data.usage?.completion_tokens || 0,
                },
                toolCalls: [], // Hermes 的工具调用在内部完成，不通过 API 返回
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[HermesClient] ${agentId} 调用失败: ${errorMsg}`);
            return {
                success: false,
                output: `❌ Hermes 调用失败: ${errorMsg}`,
                messages,
                tokenUsage: { input_tokens: 0, output_tokens: 0 },
                toolCalls: [],
            };
        }
        finally {
            clearTimeout(timeout);
            options?.signal?.removeEventListener('abort', onAbort);
        }
    }
    async sendA2AMessage(agentId, request, options) {
        const message = request.message;
        const contextId = message.contextId || `ctx-${Date.now()}`;
        const taskId = message.taskId || `task-${agentId}-${Date.now()}`;
        const goal = partsToText(message.parts);
        const result = await this.callAgent(agentId, goal, {
            systemPrompt: options?.systemPrompt,
            maxTokens: options?.maxTokens,
            sessionId: contextId,
            signal: options?.signal,
            timeoutMs: options?.timeoutMs,
        });
        const responseMessage = createA2AMessage({
            role: 'agent',
            contextId,
            taskId,
            text: result.output,
            metadata: {
                agentId,
                success: result.success,
                tokenUsage: result.tokenUsage,
                toolCalls: result.toolCalls,
            },
        });
        return {
            id: taskId,
            contextId,
            status: {
                state: result.success ? 'completed' : 'failed',
                message: responseMessage,
                timestamp: new Date().toISOString(),
            },
            history: [message, responseMessage],
            artifacts: result.output
                ? [{
                        artifactId: `artifact-${taskId}-output`,
                        name: 'agent-output',
                        description: `Output from ${agentId}`,
                        parts: [{ kind: 'text', text: result.output }],
                        metadata: {
                            agentId,
                            tokenUsage: result.tokenUsage,
                        },
                    }]
                : [],
            metadata: {
                agentId,
                transport: 'hermes-http',
            },
        };
    }
    /**
     * 批量调用多个 Agent（并行）
     */
    async callAgents(agentIds, goal, options) {
        const results = new Map();
        const promises = agentIds.map(async (agentId) => {
            const result = await this.callAgent(agentId, goal, options);
            results.set(agentId, result);
        });
        await Promise.all(promises);
        return results;
    }
    /**
     * 检查 Agent 实例是否在线
     */
    async healthCheck(agentId, timeoutMs = 1500) {
        const instance = this.instanceMap.get(agentId);
        if (!instance)
            return { online: false, latency: -1 };
        const port = instance.hermes_port || instance.port;
        const url = `http://127.0.0.1:${port}/health`;
        const startTime = Date.now();
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            return { online: response.ok, latency: Date.now() - startTime };
        }
        catch {
            return { online: false, latency: -1 };
        }
    }
    /**
     * 检查所有实例状态
     */
    async healthCheckAll(timeoutMs = 1500) {
        const results = new Map();
        const promises = this.config.instances.map(async (inst) => {
            const status = await this.healthCheck(inst.id, timeoutMs);
            results.set(inst.id, status);
        });
        await Promise.all(promises);
        return results;
    }
}
/**
 * 创建 Hermes Agent Client（便捷工厂）
 */
export function createHermesAgentClient(config) {
    return new HermesAgentClient(config);
}
/**
 * 全局单例（可选）
 */
let globalClient = null;
export function getGlobalHermesClient() {
    if (!globalClient) {
        globalClient = new HermesAgentClient();
    }
    return globalClient;
}
//# sourceMappingURL=HermesAgentClient.js.map