import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type Database from 'better-sqlite3';
import type { SqliteA2AV1Repository } from './sqlite-repository.js';

export interface A2AV1PushNotificationConfig {
  tenant: string;
  id: string;
  taskId: string;
  url: string;
  /** Callback credentials are write-only and are never returned or persisted. */
  token: '';
  authentication?: { schemes: string[] };
}

export interface A2AV1PushCallbackPolicy {
  id: string;
  hostname: string;
  secretRef?: string;
}

export interface A2AV1PushSendRequest {
  url: string;
  body: Record<string, unknown>;
  secretRef?: string;
  tokenHash?: string;
  redirect: 'error';
}

export interface A2AV1PushSendResult { status: number; redirected?: boolean; }
export type A2AV1PushDnsResolver = (hostname: string) => Promise<string[]>;
export type A2AV1PushSender = (request: Readonly<A2AV1PushSendRequest>) => Promise<A2AV1PushSendResult>;

export class A2AV1PushNotificationService {
  private readonly now: () => number;
  private readonly policies: ReadonlyMap<string, A2AV1PushCallbackPolicy>;

  constructor(private readonly options: {
    database: Database.Database;
    repository: SqliteA2AV1Repository;
    callbackPolicies: readonly A2AV1PushCallbackPolicy[];
    resolveDns: A2AV1PushDnsResolver;
    sender: A2AV1PushSender;
    now?: () => number;
  }) {
    this.now = options.now ?? Date.now;
    this.policies = new Map(options.callbackPolicies.map((policy) => [policy.hostname.toLowerCase(), Object.freeze({ ...policy })]));
    this.initializeSchema();
  }

  async setConfig(input: {
    tenantId: string; agentId: string; taskId: string; id: string; url: string;
    token?: string; authentication?: { schemes?: string[]; credentials?: string };
  }): Promise<A2AV1PushNotificationConfig> {
    requireValue(input.tenantId, 'tenantId'); requireValue(input.agentId, 'agentId');
    requireValue(input.taskId, 'taskId'); requireValue(input.id, 'id');
    const task = this.options.repository.getTask(input.tenantId, input.taskId);
    if (!task || readTaskAgentId(task) !== input.agentId) throw new Error('Task not found');
    const validated = await this.validateCallback(input.url);
    const now = this.now();
    const schemes = input.authentication?.schemes?.filter((value) => typeof value === 'string' && value.trim()) ?? [];
    this.options.database.prepare(`
      INSERT INTO a2a_v1_push_configs
        (tenant_id, agent_id, task_id, config_id, url, hostname, callback_policy_id,
         secret_ref, token_hash, auth_schemes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, agent_id, task_id, config_id) DO UPDATE SET
        url=excluded.url, hostname=excluded.hostname, callback_policy_id=excluded.callback_policy_id,
        secret_ref=excluded.secret_ref, token_hash=excluded.token_hash,
        auth_schemes_json=excluded.auth_schemes_json, updated_at=excluded.updated_at
    `).run(
      input.tenantId, input.agentId, input.taskId, input.id, validated.url, validated.hostname,
      validated.policy.id, validated.policy.secretRef ?? null,
      input.token ? sha256(input.token) : null, JSON.stringify(schemes), now, now,
    );
    return this.getConfig({ ...input })!;
  }

  getConfig(input: { tenantId: string; agentId: string; taskId: string; id: string }): A2AV1PushNotificationConfig | undefined {
    const row = this.options.database.prepare(`
      SELECT tenant_id, task_id, config_id, url, auth_schemes_json FROM a2a_v1_push_configs
      WHERE tenant_id=? AND agent_id=? AND task_id=? AND config_id=?
    `).get(input.tenantId, input.agentId, input.taskId, input.id) as Record<string, unknown> | undefined;
    return row ? publicConfig(row) : undefined;
  }

  listConfigs(input: { tenantId: string; agentId: string; taskId: string; pageSize?: number; pageToken?: string }): {
    configs: A2AV1PushNotificationConfig[]; nextPageToken: string;
  } {
    const limit = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
    const after = input.pageToken ?? '';
    const rows = this.options.database.prepare(`
      SELECT tenant_id, task_id, config_id, url, auth_schemes_json FROM a2a_v1_push_configs
      WHERE tenant_id=? AND agent_id=? AND task_id=? AND config_id>? ORDER BY config_id LIMIT ?
    `).all(input.tenantId, input.agentId, input.taskId, after, limit + 1) as Array<Record<string, unknown>>;
    const configs = rows.slice(0, limit).map(publicConfig);
    return { configs, nextPageToken: rows.length > limit ? configs.at(-1)!.id : '' };
  }

  deleteConfig(input: { tenantId: string; agentId: string; taskId: string; id: string }): boolean {
    return this.options.database.prepare(`DELETE FROM a2a_v1_push_configs WHERE tenant_id=? AND agent_id=? AND task_id=? AND config_id=?`)
      .run(input.tenantId, input.agentId, input.taskId, input.id).changes === 1;
  }

  enqueuePersistedTask(input: { tenantId: string; agentId: string; taskId: string; eventId: string }): number {
    const task = this.options.repository.getTask(input.tenantId, input.taskId);
    if (!task || readTaskAgentId(task) !== input.agentId) throw new Error('Task must be durably persisted before push enqueue');
    const configs = this.options.database.prepare(`
      SELECT config_id FROM a2a_v1_push_configs WHERE tenant_id=? AND agent_id=? AND task_id=?
    `).all(input.tenantId, input.agentId, input.taskId) as Array<{ config_id: string }>;
    let inserted = 0;
    const statement = this.options.database.prepare(`
      INSERT OR IGNORE INTO a2a_v1_push_outbox
        (delivery_id, tenant_id, agent_id, task_id, config_id, event_id, payload_json, created_at, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.options.database.transaction(() => {
      for (const config of configs) {
        const deliveryId = sha256(`${input.tenantId}\0${input.agentId}\0${input.taskId}\0${config.config_id}\0${input.eventId}`);
        inserted += statement.run(deliveryId, input.tenantId, input.agentId, input.taskId, config.config_id, input.eventId,
          JSON.stringify({ task }), this.now(), this.now()).changes;
      }
    })();
    return inserted;
  }

  async dispatchOnce(input: { tenantId: string; workerId: string; leaseMs: number; maxAttempts: number; limit?: number }): Promise<{
    delivered: number; retried: number; deadLettered: number;
  }> {
    const now = this.now(); const limit = input.limit ?? 10;
    this.options.database.prepare(`UPDATE a2a_v1_push_outbox
      SET dead_lettered_at=?, last_error_code='lease-expired-after-max-attempts',
          lease_owner=NULL, lease_token_hash=NULL, lease_expires_at=NULL
      WHERE tenant_id=? AND delivered_at IS NULL AND dead_lettered_at IS NULL
        AND attempt_count >= ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`)
      .run(now, input.tenantId, input.maxAttempts, now);
    const candidates = this.options.database.prepare(`
      SELECT delivery_id FROM a2a_v1_push_outbox WHERE tenant_id=? AND delivered_at IS NULL AND dead_lettered_at IS NULL
        AND attempt_count < ? AND next_attempt_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      ORDER BY created_at, delivery_id LIMIT ?
    `).all(input.tenantId, input.maxAttempts, now, now, limit) as Array<{ delivery_id: string }>;
    const result = { delivered: 0, retried: 0, deadLettered: 0 };
    for (const candidate of candidates) {
      const leaseToken = randomUUID(); const leaseHash = sha256(leaseToken);
      const claimed = this.options.database.prepare(`UPDATE a2a_v1_push_outbox SET lease_owner=?, lease_token_hash=?, lease_expires_at=?, attempt_count=attempt_count+1
        WHERE tenant_id=? AND delivery_id=? AND delivered_at IS NULL AND dead_lettered_at IS NULL
          AND attempt_count < ? AND next_attempt_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
        .run(input.workerId, leaseHash, now + input.leaseMs, input.tenantId, candidate.delivery_id, input.maxAttempts, now, now);
      if (claimed.changes !== 1) continue;
      const row = this.options.database.prepare(`SELECT o.*, c.url, c.hostname, c.callback_policy_id, c.secret_ref, c.token_hash
        FROM a2a_v1_push_outbox o JOIN a2a_v1_push_configs c ON c.tenant_id=o.tenant_id AND c.agent_id=o.agent_id AND c.task_id=o.task_id AND c.config_id=o.config_id
        WHERE o.tenant_id=? AND o.delivery_id=?`).get(input.tenantId, candidate.delivery_id) as Record<string, unknown> | undefined;
      let errorCode = 'delivery-failed';
      try {
        if (!row) throw new Error('config-missing');
        await this.validateCallback(String(row.url), String(row.callback_policy_id));
        const response = await this.options.sender(Object.freeze({
          url: String(row.url), body: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
          ...(row.secret_ref ? { secretRef: String(row.secret_ref) } : {}),
          ...(row.token_hash ? { tokenHash: String(row.token_hash) } : {}), redirect: 'error' as const,
        }));
        if (response.redirected || (response.status >= 300 && response.status < 400)) { errorCode = 'redirect-rejected'; throw new Error(errorCode); }
        if (response.status < 200 || response.status >= 300) { errorCode = `http-${response.status}`; throw new Error(errorCode); }
        this.options.database.prepare(`UPDATE a2a_v1_push_outbox SET delivered_at=?, lease_owner=NULL, lease_token_hash=NULL, lease_expires_at=NULL
          WHERE tenant_id=? AND delivery_id=? AND lease_owner=? AND lease_token_hash=?`)
          .run(now, input.tenantId, candidate.delivery_id, input.workerId, leaseHash);
        result.delivered++;
      } catch (error) {
        if (error instanceof Error && /callback|address|HTTPS|policy|DNS|config-missing/.test(error.message)) errorCode = 'callback-policy-rejected';
        const attempt = Number((row ?? this.options.database.prepare(`SELECT attempt_count FROM a2a_v1_push_outbox WHERE delivery_id=?`).get(candidate.delivery_id) as Record<string, unknown>).attempt_count);
        if (attempt >= input.maxAttempts) {
          this.options.database.prepare(`UPDATE a2a_v1_push_outbox SET dead_lettered_at=?, last_error_code=?, lease_owner=NULL, lease_token_hash=NULL, lease_expires_at=NULL WHERE tenant_id=? AND delivery_id=? AND lease_token_hash=?`)
            .run(now, errorCode, input.tenantId, candidate.delivery_id, leaseHash); result.deadLettered++;
        } else {
          this.options.database.prepare(`UPDATE a2a_v1_push_outbox SET next_attempt_at=?, last_error_code=?, lease_owner=NULL, lease_token_hash=NULL, lease_expires_at=NULL WHERE tenant_id=? AND delivery_id=? AND lease_token_hash=?`)
            .run(now + 1_000 * (2 ** (attempt - 1)), errorCode, input.tenantId, candidate.delivery_id, leaseHash); result.retried++;
        }
      }
    }
    return result;
  }

  async dispatchAllOnce(input: { workerId: string; leaseMs: number; maxAttempts: number; limitPerTenant?: number }): Promise<void> {
    const tenants = this.options.database.prepare(`SELECT DISTINCT tenant_id FROM a2a_v1_push_outbox
      WHERE delivered_at IS NULL AND dead_lettered_at IS NULL ORDER BY tenant_id`).all() as Array<{ tenant_id: string }>;
    for (const row of tenants) {
      await this.dispatchOnce({ tenantId: row.tenant_id, workerId: input.workerId, leaseMs: input.leaseMs,
        maxAttempts: input.maxAttempts, ...(input.limitPerTenant ? { limit: input.limitPerTenant } : {}) });
    }
  }

  listDeadLetters(tenantId: string): Array<{ deliveryId: string; attemptCount: number; errorCode: string }> {
    const rows = this.options.database.prepare(`SELECT delivery_id, attempt_count, last_error_code FROM a2a_v1_push_outbox WHERE tenant_id=? AND dead_lettered_at IS NOT NULL ORDER BY delivery_id`).all(tenantId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ deliveryId: String(row.delivery_id), attemptCount: Number(row.attempt_count), errorCode: String(row.last_error_code) }));
  }

  private async validateCallback(rawUrl: string, requiredPolicyId?: string): Promise<{ url: string; hostname: string; policy: A2AV1PushCallbackPolicy }> {
    let url: URL; try { url = new URL(rawUrl); } catch { throw new Error('Invalid callback URL'); }
    if (url.protocol !== 'https:') throw new Error('Callback URL requires HTTPS');
    if (url.username || url.password) throw new Error('Callback URL credentials are forbidden');
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const policy = this.policies.get(hostname);
    if (!policy || (requiredPolicyId && policy.id !== requiredPolicyId)) throw new Error('Callback policy rejected');
    const literal = hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && isForbiddenAddress(literal)) throw new Error('Callback address rejected');
    const addresses = await this.options.resolveDns(literal);
    if (!addresses.length || addresses.some(isForbiddenAddress)) throw new Error('Callback DNS address rejected');
    return { url: url.toString(), hostname, policy };
  }

  private initializeSchema(): void {
    this.options.database.exec(`
      CREATE TABLE IF NOT EXISTS a2a_v1_push_configs (
        tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, task_id TEXT NOT NULL, config_id TEXT NOT NULL,
        url TEXT NOT NULL, hostname TEXT NOT NULL, callback_policy_id TEXT NOT NULL, secret_ref TEXT,
        token_hash TEXT, auth_schemes_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, agent_id, task_id, config_id));
      CREATE TABLE IF NOT EXISTS a2a_v1_push_outbox (
        delivery_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, task_id TEXT NOT NULL,
        config_id TEXT NOT NULL, event_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, lease_owner TEXT,
        lease_token_hash TEXT, lease_expires_at INTEGER, delivered_at INTEGER, dead_lettered_at INTEGER,
        last_error_code TEXT, UNIQUE (tenant_id, agent_id, task_id, config_id, event_id));
      CREATE INDEX IF NOT EXISTS idx_a2a_v1_push_claim ON a2a_v1_push_outbox
        (tenant_id, delivered_at, dead_lettered_at, next_attempt_at, lease_expires_at);
    `);
  }
}

function publicConfig(row: Record<string, unknown>): A2AV1PushNotificationConfig {
  const schemes = JSON.parse(String(row.auth_schemes_json)) as string[];
  return { tenant: String(row.tenant_id), id: String(row.config_id), taskId: String(row.task_id), url: String(row.url), token: '', ...(schemes.length ? { authentication: { schemes } } : {}) };
}
function readTaskAgentId(task: { metadata?: Record<string, unknown> }): string | undefined {
  const metadata = task.metadata?.devAgentTeams;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof (metadata as Record<string, unknown>).agentId === 'string'
    ? String((metadata as Record<string, unknown>).agentId) : undefined;
}
function requireValue(value: string, field: string): void { if (!value?.trim()) throw new Error(`${field} is required`); }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function isForbiddenAddress(address: string): boolean {
  if (!isIP(address)) return true;
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const value = mapped ?? address;
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
