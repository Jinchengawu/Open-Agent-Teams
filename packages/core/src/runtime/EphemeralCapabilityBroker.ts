import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface CapabilityScope {
  tenantId: string;
  taskId: string;
  attemptId: string;
  host: string;
  operation: string;
}

export interface IssuedCapability {
  credentialId: string;
  token: string;
  expiresAt: string;
  scope: CapabilityScope;
}

export interface CapabilityValidation {
  credentialId: string;
  scope: CapabilityScope;
  expiresAt: string;
  useCount: number;
}

export interface CapabilityRevocationReceipt {
  credentialId: string;
  revokedAt: string;
  receiptId: string;
  receiptHash: string;
}

export class CapabilityRejectedError extends Error {}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function required(name: string, value: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

interface CredentialRow {
  id: string;
  tenant_id: string;
  task_id: string;
  attempt_id: string;
  host: string;
  operation: string;
  token_hash: Buffer;
  expires_at: string;
  max_uses: number;
  use_count: number;
  revoked_at: string | null;
}

/** Control-plane capability tokens; this is not a cloud/provider STS adapter. */
export class EphemeralCapabilityBroker {
  constructor(
    private readonly database: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ephemeral_capabilities (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        host TEXT NOT NULL,
        operation TEXT NOT NULL,
        token_hash BLOB NOT NULL,
        expires_at TEXT NOT NULL,
        max_uses INTEGER NOT NULL CHECK(max_uses >= 1),
        use_count INTEGER NOT NULL DEFAULT 0,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS capability_revocation_receipts (
        receipt_id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL UNIQUE,
        revoked_at TEXT NOT NULL,
        receipt_hash TEXT NOT NULL
      );
    `);
  }

  issue(input: CapabilityScope & { ttlMs: number; maxUses?: number }): IssuedCapability {
    for (const [name, value] of Object.entries({
      tenantId: input.tenantId, taskId: input.taskId, attemptId: input.attemptId,
      host: input.host, operation: input.operation,
    })) required(name, value);
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > 3_600_000) {
      throw new Error('ttlMs must be between 1 and 3600000');
    }
    const maxUses = input.maxUses ?? 1;
    if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      throw new Error('maxUses must be between 1 and 100');
    }
    const token = randomBytes(32).toString('base64url');
    const credentialId = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + input.ttlMs).toISOString();
    this.database.prepare(`
      INSERT INTO ephemeral_capabilities
        (id, tenant_id, task_id, attempt_id, host, operation, token_hash, expires_at, max_uses, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      credentialId, input.tenantId, input.taskId, input.attemptId, input.host,
      input.operation, hashToken(token), expiresAt, maxUses, createdAt.toISOString(),
    );
    return { credentialId, token, expiresAt, scope: { ...input } };
  }

  consume(credentialId: string, token: string, expected: CapabilityScope): CapabilityValidation {
    const transaction = this.database.transaction(() => {
      const row = this.database.prepare('SELECT * FROM ephemeral_capabilities WHERE id = ?')
        .get(credentialId) as CredentialRow | undefined;
      if (!row) throw new CapabilityRejectedError('credential not found');
      const actualHash = hashToken(token);
      if (actualHash.length !== row.token_hash.length || !timingSafeEqual(actualHash, row.token_hash)) {
        throw new CapabilityRejectedError('credential token mismatch');
      }
      const scopeMatches = row.tenant_id === expected.tenantId && row.task_id === expected.taskId
        && row.attempt_id === expected.attemptId && row.host === expected.host
        && row.operation === expected.operation;
      if (!scopeMatches) throw new CapabilityRejectedError('credential scope mismatch');
      if (row.revoked_at) throw new CapabilityRejectedError('credential revoked');
      if (Date.parse(row.expires_at) <= this.now().getTime()) throw new CapabilityRejectedError('credential expired');
      const update = this.database.prepare(`
        UPDATE ephemeral_capabilities SET use_count = use_count + 1
        WHERE id = ? AND revoked_at IS NULL AND use_count < max_uses
      `).run(credentialId);
      if (update.changes !== 1) throw new CapabilityRejectedError('credential use limit exhausted');
      return { ...row, use_count: row.use_count + 1 };
    });
    const row = transaction();
    return {
      credentialId: row.id,
      scope: {
        tenantId: row.tenant_id, taskId: row.task_id, attemptId: row.attempt_id,
        host: row.host, operation: row.operation,
      },
      expiresAt: row.expires_at,
      useCount: row.use_count,
    };
  }

  revoke(credentialId: string): CapabilityRevocationReceipt {
    const transaction = this.database.transaction(() => {
      const existing = this.database.prepare(
        'SELECT * FROM capability_revocation_receipts WHERE credential_id = ?',
      ).get(credentialId) as Record<string, string> | undefined;
      if (existing) return existing;
      const revokedAt = this.now().toISOString();
      const update = this.database.prepare(`
        UPDATE ephemeral_capabilities SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
      `).run(revokedAt, credentialId);
      if (update.changes !== 1) throw new CapabilityRejectedError('credential not found or already revoked without receipt');
      const receiptId = randomUUID();
      const receiptHash = createHash('sha256').update(`${credentialId}\0${revokedAt}\0${receiptId}`).digest('hex');
      this.database.prepare(`
        INSERT INTO capability_revocation_receipts (receipt_id, credential_id, revoked_at, receipt_hash)
        VALUES (?, ?, ?, ?)
      `).run(receiptId, credentialId, revokedAt, receiptHash);
      return { receipt_id: receiptId, credential_id: credentialId, revoked_at: revokedAt, receipt_hash: receiptHash };
    });
    const row = transaction();
    return {
      credentialId: row.credential_id, revokedAt: row.revoked_at,
      receiptId: row.receipt_id, receiptHash: row.receipt_hash,
    };
  }
}
