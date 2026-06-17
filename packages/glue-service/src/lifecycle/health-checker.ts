/**
 * 健康检查器
 *
 * 定期轮询 Profile /health 端点，标记不健康状态
 */

import type { ProfileManager } from './profile-manager.js';

export interface HealthCheckerConfig {
  interval: number;
  timeout: number;
  onUnhealthy?: (agentId: string) => void;
  onRecovered?: (agentId: string) => void;
}

export class HealthChecker {
  private timer?: ReturnType<typeof setInterval>;
  private config: HealthCheckerConfig;
  private profileManager: ProfileManager;
  private unhealthySince = new Map<string, Date>();

  constructor(profileManager: ProfileManager, config?: Partial<HealthCheckerConfig>) {
    this.profileManager = profileManager;
    this.config = {
      interval: config?.interval ?? 30_000,
      timeout: config?.timeout ?? 5_000,
      onUnhealthy: config?.onUnhealthy,
      onRecovered: config?.onRecovered,
    };
  }

  /** 启动定时检查 */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), this.config.interval);
    console.log(`[HealthChecker] Started with interval ${this.config.interval}ms`);
  }

  /** 停止定时检查 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.unhealthySince.clear();
  }

  /** 执行一次检查 */
  async check(): Promise<void> {
    const profiles = this.profileManager.getAllProfiles();

    for (const profile of profiles) {
      if (profile.status === 'stopped') continue;

      const result = await this.profileManager.checkHealth(profile.agentId);

      if (!result.healthy) {
        // 标记不健康
        if (!this.unhealthySince.has(profile.agentId)) {
          this.unhealthySince.set(profile.agentId, new Date());
          this.config.onUnhealthy?.(profile.agentId);
        }
      } else {
        // 恢复健康
        if (this.unhealthySince.has(profile.agentId)) {
          this.unhealthySince.delete(profile.agentId);
          this.config.onRecovered?.(profile.agentId);
        }
      }
    }
  }

  /** 获取不健康持续时间 */
  getUnhealthyDuration(agentId: string): number | null {
    const since = this.unhealthySince.get(agentId);
    if (!since) return null;
    return Date.now() - since.getTime();
  }

  /** 是否不健康 */
  isUnhealthy(agentId: string): boolean {
    return this.unhealthySince.has(agentId);
  }

  /** 清理 */
  destroy(): void {
    this.stop();
  }
}
