import type Database from 'better-sqlite3';
import type { A2AMessage, A2ATask } from './types.js';

export interface A2AHistoryStore {
  appendMessage(agentId: string, message: A2AMessage): void;
  appendTask(agentId: string, task: A2ATask): void;
  getMessageHistory(agentId: string): A2AMessage[];
  getTaskHistory(agentId: string): A2ATask[];
}

export class SqliteA2AHistoryStore implements A2AHistoryStore {
  constructor(private readonly db: Database.Database) {
    this.initSchema();
  }

  appendMessage(agentId: string, message: A2AMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO a2a_messages (
        id, agent_id, context_id, task_id, role, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `).run(
      message.messageId,
      agentId,
      message.contextId || null,
      message.taskId || null,
      message.role,
      JSON.stringify(message),
      this.readTimestamp(message.metadata),
    );
  }

  appendTask(agentId: string, task: A2ATask): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO a2a_tasks (
        id, agent_id, context_id, state, payload_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      task.id,
      agentId,
      task.contextId || null,
      task.status.state,
      JSON.stringify(task),
    );
  }

  getMessageHistory(agentId: string): A2AMessage[] {
    return this.db.prepare(`
      SELECT payload_json FROM a2a_messages
      WHERE agent_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(agentId).map((row) => JSON.parse((row as { payload_json: string }).payload_json) as A2AMessage);
  }

  getTaskHistory(agentId: string): A2ATask[] {
    return this.db.prepare(`
      SELECT payload_json FROM a2a_tasks
      WHERE agent_id = ?
      ORDER BY updated_at ASC, id ASC
    `).all(agentId).map((row) => JSON.parse((row as { payload_json: string }).payload_json) as A2ATask);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS a2a_messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        context_id TEXT,
        task_id TEXT,
        role TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_messages_agent ON a2a_messages(agent_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_a2a_messages_context ON a2a_messages(context_id);
      CREATE INDEX IF NOT EXISTS idx_a2a_messages_task ON a2a_messages(task_id);

      CREATE TABLE IF NOT EXISTS a2a_tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        context_id TEXT,
        state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_tasks_agent ON a2a_tasks(agent_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_a2a_tasks_state ON a2a_tasks(state);
      CREATE INDEX IF NOT EXISTS idx_a2a_tasks_context ON a2a_tasks(context_id);
    `);
  }

  private readTimestamp(metadata?: Record<string, unknown>): string | null {
    const value = metadata?.timestamp || metadata?.createdAt;
    return typeof value === 'string' ? value : null;
  }
}
