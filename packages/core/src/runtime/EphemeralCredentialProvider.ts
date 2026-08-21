import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CapabilityRevocationReceipt,
  CapabilityScope,
  EphemeralCapabilityBroker,
} from './EphemeralCapabilityBroker.js';

export interface EphemeralCredentialScope {
  tenantId: string;
  taskId: string;
  attemptId: string;
  audience: string;
  host: string;
  operation: string;
}

export interface EphemeralCredentialRequest extends EphemeralCredentialScope {
  ttlMs: number;
}

export interface IssuedEphemeralCredential {
  provider: string;
  credentialId: string;
  secret: string;
  expiresAt: string;
  scope: EphemeralCredentialScope & { ttlMs: number };
}

export interface EphemeralCredentialValidation {
  credentialId: string;
  expiresAt: string;
  scope: EphemeralCredentialScope & { ttlMs: number };
}

export interface EphemeralCredentialRevocationReceipt extends CapabilityRevocationReceipt {
  provider: string;
  reason: string;
  brokerReceiptHash: string;
}

export interface EphemeralCredentialProvider {
  issue(request: EphemeralCredentialRequest): Promise<IssuedEphemeralCredential>;
  validate(input: {
    credentialId: string;
    secret: string;
    expected: EphemeralCredentialRequest;
  }): Promise<EphemeralCredentialValidation>;
  revoke(input: { credentialId: string; reason: string }): Promise<EphemeralCredentialRevocationReceipt>;
}

export class CredentialProviderRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialProviderRejectedError';
  }
}

const PROVIDER = 'local-sts/v1';
const MAX_TTL_MS = 60_000;
const SECRET_PREFIX = 'dat_sts_';

function requireValue(name: string, value: string): void {
  if (!value.trim()) throw new CredentialProviderRejectedError(`${name} is required`);
}

function validateRequest(request: EphemeralCredentialRequest): void {
  for (const [name, value] of Object.entries({
    tenantId: request.tenantId, taskId: request.taskId, attemptId: request.attemptId,
    audience: request.audience, host: request.host, operation: request.operation,
  })) requireValue(name, value);
  if (!Number.isSafeInteger(request.ttlMs) || request.ttlMs < 1 || request.ttlMs > MAX_TTL_MS) {
    throw new CredentialProviderRejectedError(`ttlMs must be between 1 and ${MAX_TTL_MS}`);
  }
}

function brokerScope(scope: EphemeralCredentialScope): CapabilityScope {
  // The NUL-delimited audience binding is internal to this adapter and cannot
  // collide with a valid host. The broker still enforces exact equality.
  return {
    tenantId: scope.tenantId, taskId: scope.taskId, attemptId: scope.attemptId,
    host: `${scope.audience}\0${scope.host}`, operation: scope.operation,
  };
}

/**
 * Runnable local/test STS adapter backed by the durable capability broker.
 * It does not mint a cloud credential and must not be described as cloud STS.
 */
export class LocalStsCredentialProvider implements EphemeralCredentialProvider {
  constructor(
    private readonly broker: EphemeralCapabilityBroker,
    private readonly database: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS local_sts_credentials (
        credential_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        audience TEXT NOT NULL,
        host TEXT NOT NULL,
        operation TEXT NOT NULL,
        ttl_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_sts_revocation_receipts (
        credential_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        receipt_json TEXT NOT NULL
      );
    `);
  }

  async issue(request: EphemeralCredentialRequest): Promise<IssuedEphemeralCredential> {
    validateRequest(request);
    try {
      const issued = this.database.transaction(() => {
        const credential = this.broker.issue({ ...brokerScope(request), ttlMs: request.ttlMs });
        this.database.prepare(`
          INSERT INTO local_sts_credentials
            (credential_id, tenant_id, task_id, attempt_id, audience, host, operation, ttl_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          credential.credentialId, request.tenantId, request.taskId, request.attemptId,
          request.audience, request.host, request.operation, request.ttlMs, this.now().toISOString(),
        );
        return credential;
      })();
      const scope = { ...request };
      return {
        provider: PROVIDER, credentialId: issued.credentialId,
        secret: `${SECRET_PREFIX}${issued.token}`, expiresAt: issued.expiresAt, scope,
      };
    } catch (error) {
      throw reject(error);
    }
  }

  async validate(input: {
    credentialId: string; secret: string; expected: EphemeralCredentialRequest;
  }): Promise<EphemeralCredentialValidation> {
    validateRequest(input.expected);
    if (!input.secret.startsWith(SECRET_PREFIX)) throw new CredentialProviderRejectedError('credential token mismatch');
    try {
      const issued = this.readScope(input.credentialId);
      if (!issued || !sameScope(issued, input.expected)) throw new CredentialProviderRejectedError('credential scope mismatch');
      const validated = this.broker.consume(
        input.credentialId, input.secret.slice(SECRET_PREFIX.length), brokerScope(input.expected),
      );
      return { credentialId: validated.credentialId, expiresAt: validated.expiresAt, scope: { ...issued } };
    } catch (error) {
      throw reject(error);
    }
  }

  async revoke(input: { credentialId: string; reason: string }): Promise<EphemeralCredentialRevocationReceipt> {
    requireValue('credentialId', input.credentialId);
    requireValue('reason', input.reason);
    const existing = this.database.prepare(
      'SELECT reason, receipt_json FROM local_sts_revocation_receipts WHERE credential_id = ?',
    ).get(input.credentialId) as { reason: string; receipt_json: string } | undefined;
    if (existing) {
      if (existing.reason !== input.reason) throw new CredentialProviderRejectedError('revocation reason mismatch');
      return JSON.parse(existing.receipt_json) as EphemeralCredentialRevocationReceipt;
    }
    try {
      const receipt = this.database.transaction(() => {
        if (!this.readScope(input.credentialId)) throw new CredentialProviderRejectedError('credential not found');
        const brokerReceipt = this.broker.revoke(input.credentialId);
        const persisted = {
          ...brokerReceipt, provider: PROVIDER, reason: input.reason,
          brokerReceiptHash: brokerReceipt.receiptHash,
          receiptHash: createHash('sha256').update(
            `${brokerReceipt.receiptHash}\0${PROVIDER}\0${input.reason}`,
          ).digest('hex'),
        };
        this.database.prepare(`
          INSERT INTO local_sts_revocation_receipts (credential_id, reason, receipt_json) VALUES (?, ?, ?)
        `).run(input.credentialId, input.reason, JSON.stringify(persisted));
        return persisted;
      })();
      return structuredClone(receipt);
    } catch (error) {
      throw reject(error);
    }
  }

  private readScope(credentialId: string): EphemeralCredentialRequest | undefined {
    const row = this.database.prepare(`
      SELECT tenant_id, task_id, attempt_id, audience, host, operation, ttl_ms
      FROM local_sts_credentials WHERE credential_id = ?
    `).get(credentialId) as Record<string, string | number> | undefined;
    return row ? {
      tenantId: String(row.tenant_id), taskId: String(row.task_id), attemptId: String(row.attempt_id),
      audience: String(row.audience), host: String(row.host), operation: String(row.operation), ttlMs: Number(row.ttl_ms),
    } : undefined;
  }
}

export function verifyEphemeralCredentialRevocationReceipt(
  receipt: EphemeralCredentialRevocationReceipt,
): boolean {
  const expected = createHash('sha256').update(
    `${receipt.brokerReceiptHash}\0${receipt.provider}\0${receipt.reason}`,
  ).digest('hex');
  return expected === receipt.receiptHash;
}

function sameScope(left: EphemeralCredentialRequest, right: EphemeralCredentialRequest): boolean {
  return left.tenantId === right.tenantId && left.taskId === right.taskId
    && left.attemptId === right.attemptId && left.audience === right.audience
    && left.host === right.host && left.operation === right.operation && left.ttlMs === right.ttlMs;
}

function reject(error: unknown): CredentialProviderRejectedError {
  if (error instanceof CredentialProviderRejectedError) return error;
  return new CredentialProviderRejectedError(
    redactCredentialDiagnostic(error instanceof Error ? error.message : 'credential provider failure'),
  );
}

export function redactCredentialDiagnostic(value: string, exactSecrets: readonly string[] = []): string {
  let redacted = value;
  for (const secret of exactSecrets) if (secret) redacted = redacted.split(secret).join('[REDACTED]');
  return redacted
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:secret|token|credential)\s*=\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
