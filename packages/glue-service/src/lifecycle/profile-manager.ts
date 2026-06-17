/**
 * Profile 生命周期管理
 *
 * 管理 Hermes Profile 的启动/停止/健康检查/自愈
 */

import type { ProfileConfig, ProfileInfo, ProfileStatus, HealthCheckResult } from '../types.js';

export class ProfileManager {
  private profiles = new Map<string, ProfileInfo>();
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private config: {
    healthCheckInterval: number;
    healthCheckTimeout: number;
    maxRestartCount: number;
    autoRestart: boolean;
  };

  constructor(config?: {
    healthCheckInterval?: number;
    healthCheckTimeout?: number;
    maxRestartCount?: number;
    autoRestart?: boolean;
  }) {
    this.config = {
      healthCheckInterval: config?.healthCheckInterval ?? 30_000,
      healthCheckTimeout: config?.healthCheckTimeout ?? 5_000,
      maxRestartCount: config?.maxRestartCount ?? 3,
      autoRestart: config?.autoRestart ?? true,
    };
  }

  /** 注册 Profile */
  register(profileConfig: ProfileConfig): void {
    const info: ProfileInfo = {
      agentId: profileConfig.agentId,
      name: profileConfig.name,
      role: profileConfig.role,
      port: profileConfig.port,
      status: 'stopped',
      restartCount: 0,
    };
    this.profiles.set(profileConfig.agentId, info);
  }

  /** 注销 Profile */
  unregister(agentId: string): void {
    this.profiles.delete(agentId);
  }

  /** 获取 Profile 信息 */
  getProfile(agentId: string): ProfileInfo | undefined {
    return this.profiles.get(agentId);
  }

  /** 获取所有 Profile */
  getAllProfiles(): ProfileInfo[] {
    return Array.from(this.profiles.values());
  }

  /** 获取运行中的 Profile */
  getRunningProfiles(): ProfileInfo[] {
    return this.getAllProfiles().filter(p => p.status === 'running');
  }

  /** 更新 Profile 状态 */
  updateStatus(agentId: string, status: ProfileStatus, error?: string): void {
    const profile = this.profiles.get(agentId);
    if (!profile) return;
    profile.status = status;
    profile.error = error;
    if (status === 'running') {
      profile.lastHealthCheck = new Date();
    }
  }

  /** 设置 Profile PID */
  setPid(agentId: string, pid: number): void {
    const profile = this.profiles.get(agentId);
    if (profile) profile.pid = pid;
  }

  /** 健康检查（单个 Profile） */
  async checkHealth(agentId: string): Promise<HealthCheckResult> {
    const profile = this.profiles.get(agentId);
    if (!profile) {
      return { agentId, healthy: false, latency: 0, error: 'Profile not found' };
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.healthCheckTimeout);

      const response = await fetch(`http://127.0.0.1:${profile.port}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latency = Date.now() - start;
      const healthy = response.ok;

      if (healthy) {
        profile.lastHealthCheck = new Date();
        profile.status = 'running';
        profile.error = undefined;
      }

      return { agentId, healthy, latency };
    } catch (error) {
      const latency = Date.now() - start;
      return {
        agentId,
        healthy: false,
        latency,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 健康检查（所有 Profile） */
  async checkAllHealth(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    for (const profile of this.profiles.values()) {
      if (profile.status === 'stopped') continue;
      const result = await this.checkHealth(profile.agentId);
      results.push(result);

      // 自动重启逻辑
      if (!result.healthy && this.config.autoRestart && profile.status === 'running') {
        profile.status = 'unhealthy';
        if (profile.restartCount < this.config.maxRestartCount) {
          profile.restartCount++;
          // 实际重启逻辑由 ProcessManager 处理
          // 这里只标记状态，外部监听 unhealthy 事件后触发重启
        }
      }
    }
    return results;
  }

  /** 启动定时健康检查 */
  startHealthCheckLoop(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(
      () => this.checkAllHealth(),
      this.config.healthCheckInterval
    );
  }

  /** 停止定时健康检查 */
  stopHealthCheckLoop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /** 获取状态摘要 */
  getSummary(): { total: number; running: number; unhealthy: number; stopped: number } {
    const profiles = this.getAllProfiles();
    return {
      total: profiles.length,
      running: profiles.filter(p => p.status === 'running').length,
      unhealthy: profiles.filter(p => p.status === 'unhealthy').length,
      stopped: profiles.filter(p => p.status === 'stopped').length,
    };
  }

  /** 清理 */
  destroy(): void {
    this.stopHealthCheckLoop();
    this.profiles.clear();
  }
}
