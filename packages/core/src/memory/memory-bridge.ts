/**
 * 记忆桥接（层3）
 *
 * 只读桥接 Hermes Profile 的记忆和技能。
 * 支持跨 Profile 状态共享，保持 Hermes 自进化闭环完整。
 */

import type Database from 'better-sqlite3';
import type { ProfileManager } from '../../glue-service/src/lifecycle/profile-manager.js';

/** Profile 记忆条目 */
export interface ProfileMemoryEntry {
  agentId: string;
  key: string;
  value: string;
  source: 'profile' | 'shared';
  retrieved_at: string;
}

/** Profile 技能 */
export interface ProfileSkill {
  agentId: string;
  name: string;
  description: string;
  version?: string;
  source: 'profile';
}

/** 共享状态条目 */
export interface SharedStateEntry {
  key: string;
  value: string;
  owner: string; // agentId
  version: number;
  updated_at: string;
}

export interface MemoryBridgeConfig {
  /** 请求超时（ms） */
  requestTimeout?: number;
}

export class MemoryBridge {
  private db: Database.Database;
  private profileManager: ProfileManager;
  private config: { requestTimeout: number };

  constructor(db: Database.Database, profileManager: ProfileManager, config?: MemoryBridgeConfig) {
    this.db = db;
    this.profileManager = profileManager;
    this.config = { requestTimeout: config?.requestTimeout ?? 5_000 };
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shared_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        owner      TEXT NOT NULL,
        version    INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // ==================== 跨 Profile 状态共享 ====================

  /** 设置共享状态 */
  setSharedState(key: string, value: string, owner: string): void {
    const existing = this.getSharedState(key);
    if (existing) {
      this.db.prepare(`
        UPDATE shared_state SET value = ?, owner = ?, version = version + 1, updated_at = datetime('now')
        WHERE key = ?
      `).run(value, owner, key);
    } else {
      this.db.prepare(`
        INSERT INTO shared_state (key, value, owner) VALUES (?, ?, ?)
      `).run(key, value, owner);
    }
  }

  /** 获取共享状态 */
  getSharedState(key: string): SharedStateEntry | null {
    return (this.db.prepare('SELECT * FROM shared_state WHERE key = ?').get(key) as SharedStateEntry) ?? null;
  }

  /** 列出共享状态 */
  listSharedState(owner?: string): SharedStateEntry[] {
    if (owner) {
      return this.db.prepare('SELECT * FROM shared_state WHERE owner = ? ORDER BY updated_at DESC').all(owner) as SharedStateEntry[];
    }
    return this.db.prepare('SELECT * FROM shared_state ORDER BY updated_at DESC').all() as SharedStateEntry[];
  }

  /** 删除共享状态 */
  deleteSharedState(key: string): boolean {
    const result = this.db.prepare('DELETE FROM shared_state WHERE key = ?').run(key);
    return result.changes > 0;
  }

  // ==================== Profile 记忆查询（只读桥接） ====================

  /** 查询 Profile 记忆（通过 HTTP API） */
  async queryProfileMemory(agentId: string, query: string): Promise<ProfileMemoryEntry[]> {
    const profile = this.profileManager.getProfile(agentId);
    if (!profile || profile.status !== 'running') {
      return [];
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout);

      const response = await fetch(`http://127.0.0.1:${profile.port}/memory/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return [];

      const data = await response.json() as { results: Array<{ key: string; value: string }> };
      return data.results.map(r => ({
        agentId,
        key: r.key,
        value: r.value,
        source: 'profile' as const,
        retrieved_at: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  /** 查询 Profile 技能（通过 HTTP API） */
  async queryProfileSkills(agentId: string): Promise<ProfileSkill[]> {
    const profile = this.profileManager.getProfile(agentId);
    if (!profile || profile.status !== 'running') {
      return [];
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout);

      const response = await fetch(`http://127.0.0.1:${profile.port}/skills`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return [];

      const data = await response.json() as { skills: Array<{ name: string; description: string; version?: string }> };
      return data.skills.map(s => ({
        agentId,
        name: s.name,
        description: s.description,
        version: s.version,
        source: 'profile' as const,
      }));
    } catch {
      return [];
    }
  }

  // ==================== 上下文注入 ====================

  /** 构建共享上下文（用于 Agent 提示词注入） */
  buildSharedContext(agentId?: string): string {
    const states = this.listSharedState();
    if (states.length === 0) return '';

    const lines = states.map(s => {
      const ownerLabel = s.owner === agentId ? '（本 Agent）' : `（${s.owner}）`;
      return `- [${s.key}]${ownerLabel}: ${s.value}`;
    });

    return `## 团队共享状态\n\n${lines.join('\n')}`;
  }

  /** 构建跨 Profile 上下文（包含共享状态 + 其他 Agent 的记忆） */
  async buildCrossProfileContext(agentId: string, otherAgents: string[]): Promise<string> {
    const parts: string[] = [];

    // 1. 共享状态
    const sharedContext = this.buildSharedContext(agentId);
    if (sharedContext) parts.push(sharedContext);

    // 2. 其他 Agent 的记忆摘要
    for (const otherAgent of otherAgents) {
      if (otherAgent === agentId) continue;
      const memories = await this.queryProfileMemory(otherAgent, '');
      if (memories.length > 0) {
        const summary = memories.slice(0, 5).map(m => `- ${m.key}: ${m.value}`).join('\n');
        parts.push(`## ${otherAgent} 的记忆\n\n${summary}`);
      }
    }

    return parts.join('\n\n');
  }
}
