import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { EphemeralCapabilityBroker } from './EphemeralCapabilityBroker.js';
import {
  LocalStsCredentialProvider,
  redactCredentialDiagnostic,
  verifyEphemeralCredentialRevocationReceipt,
} from './EphemeralCredentialProvider.js';
import { KvmUnavailableError, QemuKvmRuntimeProbe } from './MicroVmRuntimeProbe.js';

test('durable local STS preserves exact scope and revocation receipt across recreation', async () => {
  const database = new Database(':memory:');
  const now = () => new Date('2026-08-13T00:00:00.000Z');
  try {
    const request = {
      tenantId: 'tenant', taskId: 'task', attemptId: 'attempt', audience: 'api',
      host: 'api.internal', operation: 'read', ttlMs: 30_000,
    };
    const first = new LocalStsCredentialProvider(new EphemeralCapabilityBroker(database, now), database, now);
    const issued = await first.issue(request);
    const reopened = new LocalStsCredentialProvider(new EphemeralCapabilityBroker(database, now), database, now);
    await assert.rejects(
      reopened.validate({ credentialId: issued.credentialId, secret: issued.secret, expected: { ...request, audience: 'other' } }),
      /scope mismatch/,
    );
    await reopened.validate({ credentialId: issued.credentialId, secret: issued.secret, expected: request });
    const receipt = await reopened.revoke({ credentialId: issued.credentialId, reason: 'done' });
    assert.equal(verifyEphemeralCredentialRevocationReceipt(receipt), true);
    const reopenedAgain = new LocalStsCredentialProvider(new EphemeralCapabilityBroker(database, now), database, now);
    assert.deepEqual(await reopenedAgain.revoke({ credentialId: issued.credentialId, reason: 'done' }), receipt);
  } finally {
    database.close();
  }
});

test('credential diagnostics redact exact and token-shaped secrets', () => {
  const secret = 'dat_sts_private';
  const diagnostic = redactCredentialDiagnostic(`secret=${secret} Authorization: Bearer other`, [secret]);
  assert.equal(diagnostic.includes(secret), false);
  assert.equal(diagnostic.includes('other'), false);
});

test('microVM probe attests creation and cleanup but fails closed on unavailable KVM', async () => {
  const probe = new QemuKvmRuntimeProbe(
    { run: async () => ({ exitCode: 124, stdout: '', stderr: '', cleanupVerified: true }) },
    () => new Date('2026-08-13T00:00:00.000Z'), { linux: true, kvmDevice: true },
  );
  const receipt = await probe.probe();
  assert.match(receipt.cleanupReceipt, /^qemu-process-timeout-reaped:/);
  const unavailable = new QemuKvmRuntimeProbe(
    { run: async () => ({ exitCode: 1, stdout: '', stderr: 'no KVM', cleanupVerified: true }) },
    now, { linux: true, kvmDevice: true },
  );
  await assert.rejects(unavailable.probe(), KvmUnavailableError);
});

const now = () => new Date('2026-08-13T00:00:00.000Z');
