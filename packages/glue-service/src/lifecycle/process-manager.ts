/**
 * Python 进程管理
 *
 * 管理 Hermes Python 进程的 spawn/kill/优雅停机
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { ProfileConfig } from '../types.js';

export interface ProcessInfo {
  agentId: string;
  process: ChildProcess;
  startTime: Date;
}

export class ProcessManager {
  private processes = new Map<string, ProcessInfo>();
  private shutdownTimeout: number;

  constructor(config?: { shutdownTimeout?: number }) {
    this.shutdownTimeout = config?.shutdownTimeout ?? 10_000;
  }

  /** 启动 Hermes Profile 进程 */
  async start(config: ProfileConfig): Promise<number> {
    if (this.processes.has(config.agentId)) {
      throw new Error(`Process for ${config.agentId} already running`);
    }

    const pythonPath = config.pythonPath ?? 'python3';
    const scriptPath = config.scriptPath ?? '-m hermes';
    const args = scriptPath.split(' ');

    const env = {
      ...process.env,
      ...config.env,
      HERMES_AGENT_ID: config.agentId,
      HERMES_PORT: String(config.port),
    };

    const child = spawn(pythonPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    const info: ProcessInfo = {
      agentId: config.agentId,
      process: child,
      startTime: new Date(),
    };
    this.processes.set(config.agentId, info);

    // 监听进程退出
    child.on('exit', (code, signal) => {
      this.processes.delete(config.agentId);
      console.log(`[ProcessManager] ${config.agentId} exited: code=${code}, signal=${signal}`);
    });

    child.on('error', (error) => {
      console.error(`[ProcessManager] ${config.agentId} error:`, error.message);
      this.processes.delete(config.agentId);
    });

    // 返回 PID
    return child.pid ?? 0;
  }

  /** 停止进程（优雅停机） */
  async stop(agentId: string): Promise<boolean> {
    const info = this.processes.get(agentId);
    if (!info) return false;

    const { process: child } = info;

    // Step 1: SIGTERM（优雅退出）
    child.kill('SIGTERM');

    // Step 2: 等待进程退出
    const exited = await this.waitForExit(child, this.shutdownTimeout);
    if (exited) return true;

    // Step 3: 超时后 SIGKILL
    console.warn(`[ProcessManager] ${agentId} did not exit gracefully, sending SIGKILL`);
    child.kill('SIGKILL');

    return this.waitForExit(child, 5000);
  }

  /** 停止所有进程 */
  async stopAll(): Promise<void> {
    const agents = Array.from(this.processes.keys());
    await Promise.all(agents.map(id => this.stop(id)));
  }

  /** 检查进程是否运行中 */
  isRunning(agentId: string): boolean {
    return this.processes.has(agentId);
  }

  /** 获取进程信息 */
  getProcess(agentId: string): ProcessInfo | undefined {
    return this.processes.get(agentId);
  }

  /** 获取所有进程 */
  getAllProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /** 等待进程退出 */
  private waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        resolve(false);
      }, timeout);

      child.on('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** 清理 */
  destroy(): void {
    this.processes.clear();
  }
}
