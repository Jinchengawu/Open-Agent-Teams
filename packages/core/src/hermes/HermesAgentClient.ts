/**
 * Hermes Agent Client
 *
 * 封装 Hermes Agent 的 HTTP API 调用，作为 OpenMultiAgent 的替代。
 * 每个 Hermes 实例运行在独立端口（如 8201-8205），已自带工具、记忆、RAG。
 * 平台层只负责调用，不重复实现单 Agent 能力。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// yaml 包类型声明（避免安装 @types/yaml）
declare module 'yaml' {
  export function parse(content: string): any;
}
import { parse as parseYaml } from 'yaml';

// ============================================================================
// Types
// ============================================================================

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
    rules: { tags: string[]; instance: string }[];
    default: string;
  };
}

export interface HermesAgentResult {
  success: boolean;
  output: string;
  messages: { role: string; content: string }[];
  tokenUsage: { input_tokens: number; output_tokens: number };
  toolCalls: { toolName: string; result?: string }[];
}

// ============================================================================
// Configuration Loader
// ============================================================================

const CONFIG_PATHS = [
  join(process.cwd(), 'config/oma/instances.yaml'),
  join(process.cwd(), '../config/oma/instances.yaml'),
  join(process.cwd(), '../../config/oma/instances.yaml'),
];

function loadConfig(): HermesConfig {
  for (const path of CONFIG_PATHS) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        return parseYaml(content) as HermesConfig;
      } catch (error) {
        console.warn(`[HermesClient] 加载配置失败: ${path}`, error);
      }
    }
  }

  // 默认配置（fallback）— 调用真正的 Hermes 实例（API Server 端口）
  return {
    instances: [
      { id: 'dev-frontend', label: '前端开发 Agent', port: 8002, hermes_port: 8002, tags: ['frontend'], skills: [], timeout_ms: 120000 },
      { id: 'dev-backend', label: '后端开发 Agent', port: 8003, hermes_port: 8003, tags: ['backend'], skills: [], timeout_ms: 120000 },
      { id: 'dev-testing', label: '测试开发 Agent', port: 8004, hermes_port: 8004, tags: ['testing'], skills: [], timeout_ms: 180000 },
      { id: 'dev-devops', label: 'DevOps Agent', port: 8005, hermes_port: 8005, tags: ['devops'], skills: [], timeout_ms: 300000 },
      { id: 'dev-pm', label: '产品经理 Agent', port: 8006, hermes_port: 8006, tags: ['pm'], skills: [], timeout_ms: 120000 },
      { id: 'project-admin', label: '项目管理员 Agent', port: 8007, hermes_port: 8007, tags: ['project-admin'], skills: [], timeout_ms: 120000 },
    ],
    routing: { rules: [], default: 'dev-backend' },
  };
}

// ============================================================================
// Hermes Agent Client
// ============================================================================

export class HermesAgentClient {
  private config: HermesConfig;
  private instanceMap: Map<string, HermesInstance>;

  constructor(config?: HermesConfig) {
    this.config = config || loadConfig();
    this.instanceMap = new Map();
    for (const inst of this.config.instances) {
      this.instanceMap.set(inst.id, inst);
    }
  }

  /**
   * 获取所有实例列表
   */
  getInstances(): HermesInstance[] {
    return this.config.instances;
  }

  /**
   * 获取指定实例配置
   */
  getInstance(agentId: string): HermesInstance | undefined {
    return this.instanceMap.get(agentId);
  }

  /**
   * 调用单个 Hermes Agent 实例
   *
   * 通过 HTTP POST 到 Hermes 的 /v1/chat/completions 端点
   */
  async callAgent(agentId: string, goal: string, options?: {
    systemPrompt?: string;
    maxTokens?: number;
    sessionId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<HermesAgentResult> {
    const instance = this.instanceMap.get(agentId);
    if (!instance) {
      throw new Error(`Hermes 实例 "${agentId}" 未找到。可用实例: ${Array.from(this.instanceMap.keys()).join(', ')}`);
    }

    const port = instance.hermes_port || instance.port;
    const url = `http://127.0.0.1:${port}/v1/chat/completions`;

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: options?.systemPrompt || `你是 ${instance.label}。` },
      { role: 'user', content: goal },
    ];

    const requestBody = {
      model: 'hermes-agent',
      messages: messages, // ← 发送完整的 messages（含 system prompt）
      max_tokens: options?.maxTokens || 4000,
      stream: false,
    };

    const headers: Record<string, string> = {
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
    } else {
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

      const data = await response.json() as any;
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[HermesClient] ${agentId} 调用失败: ${errorMsg}`);

      return {
        success: false,
        output: `❌ Hermes 调用失败: ${errorMsg}`,
        messages,
        tokenUsage: { input_tokens: 0, output_tokens: 0 },
        toolCalls: [],
      };
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * 批量调用多个 Agent（并行）
   */
  async callAgents(
    agentIds: string[],
    goal: string,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
    },
  ): Promise<Map<string, HermesAgentResult>> {
    const results = new Map<string, HermesAgentResult>();

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
  async healthCheck(agentId: string, timeoutMs = 1500): Promise<{ online: boolean; latency: number }> {
    const instance = this.instanceMap.get(agentId);
    if (!instance) return { online: false, latency: -1 };

    const port = instance.hermes_port || instance.port;
    const url = `http://127.0.0.1:${port}/health`;
    const startTime = Date.now();

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return { online: response.ok, latency: Date.now() - startTime };
    } catch {
      return { online: false, latency: -1 };
    }
  }

  /**
   * 检查所有实例状态
   */
  async healthCheckAll(timeoutMs = 1500): Promise<Map<string, { online: boolean; latency: number }>> {
    const results = new Map<string, { online: boolean; latency: number }>();

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
export function createHermesAgentClient(config?: HermesConfig): HermesAgentClient {
  return new HermesAgentClient(config);
}

/**
 * 全局单例（可选）
 */
let globalClient: HermesAgentClient | null = null;

export function getGlobalHermesClient(): HermesAgentClient {
  if (!globalClient) {
    globalClient = new HermesAgentClient();
  }
  return globalClient;
}
