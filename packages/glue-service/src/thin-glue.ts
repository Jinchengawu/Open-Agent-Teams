/**
 * 薄胶水（ThinGlue）
 *
 * 单 Agent 任务透传 + 指数退避重试 + fallback 降级
 */

import type {
  ProfileConfig,
  TaskRequest,
  TaskResponse,
  ProfileManager,
} from './types.js';

export interface ThinGlueConfig {
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 基础延迟（ms），默认 1000 */
  baseDelay?: number;
  /** 请求超时（ms），默认 30000 */
  timeout?: number;
  /** Fallback 处理器（当 Profile 不可用时） */
  fallbackHandler?: (request: TaskRequest) => Promise<TaskResponse>;
}

export class ThinGlue {
  private profileManager: ProfileManager;
  private config: Required<Omit<ThinGlueConfig, 'fallbackHandler'>> & { fallbackHandler?: ThinGlueConfig['fallbackHandler'] };

  constructor(profileManager: ProfileManager, config?: ThinGlueConfig) {
    this.profileManager = profileManager;
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      baseDelay: config?.baseDelay ?? 1000,
      timeout: config?.timeout ?? 30_000,
      fallbackHandler: config?.fallbackHandler,
    };
  }

  /** 执行单个任务 */
  async executeTask(request: TaskRequest): Promise<TaskResponse> {
    const startTime = Date.now();

    // 检查 Profile 是否可用
    const profile = this.profileManager.getProfile(request.agentId);
    if (!profile || profile.status !== 'running') {
      // 尝试 fallback
      if (this.config.fallbackHandler) {
        return this.config.fallbackHandler(request);
      }
      throw new Error(`Profile ${request.agentId} not available`);
    }

    // 带重试的请求
    return this.executeWithRetry(request, profile.port);
  }

  /** 带指数退避重试的请求 */
  private async executeWithRetry(request: TaskRequest, port: number): Promise<TaskResponse> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.sendRequest(request, port);
        return {
          agentId: request.agentId,
          output: response.output,
          tokens: response.tokens,
          duration: Date.now() - startTime,
          source: 'profile',
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries) {
          // 指数退避: 1s → 2s → 4s
          const delay = this.config.baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // 所有重试都失败，尝试 fallback
    if (this.config.fallbackHandler) {
      return this.config.fallbackHandler(request);
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /** 发送 HTTP 请求到 Profile */
  private async sendRequest(request: TaskRequest, port: number): Promise<{ output: string; tokens: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: request.task,
          context: request.context,
          session_id: request.sessionId,
          max_tokens: request.maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { output: string; tokens?: number };
      return {
        output: data.output,
        tokens: data.tokens ?? 0,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 批量并行任务 */
  async executeParallel(
    requests: TaskRequest[],
    options?: { maxConcurrency?: number; timeout?: number }
  ): Promise<{ results: Map<string, TaskResponse>; failed: string[]; totalTokens: number; totalDuration: number }> {
    const startTime = Date.now();
    const maxConcurrency = options?.maxConcurrency ?? 5;
    const results = new Map<string, TaskResponse>();
    const failed: string[] = [];
    let totalTokens = 0;

    // 分批执行
    for (let i = 0; i < requests.length; i += maxConcurrency) {
      const batch = requests.slice(i, i + maxConcurrency);
      const promises = batch.map(async (req) => {
        try {
          const response = await this.executeTask(req);
          results.set(req.agentId, response);
          totalTokens += response.tokens;
        } catch (error) {
          failed.push(req.agentId);
        }
      });
      await Promise.allSettled(promises);
    }

    return {
      results,
      failed,
      totalTokens,
      totalDuration: Date.now() - startTime,
    };
  }
}
