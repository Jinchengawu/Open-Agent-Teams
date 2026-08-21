import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSandboxIsolation, SandboxAdmissionError } from './ExecutionSandbox.js';
import { ResilientCallExecutor, ResilienceRejectedError, isRetryableCallFailure } from './ResilientCallExecutor.js';
import { StagedGitWorkspaceManager } from './StagedGitWorkspace.js';
import { VerificationPolicyRegistry } from './VerificationPolicyRegistry.js';

test('ExecutionSandbox rejects an isolation downgrade', () => {
  assert.throws(() => assertSandboxIsolation('local-policy', 'container'), SandboxAdmissionError);
  assert.doesNotThrow(() => assertSandboxIsolation('microvm', 'container'));
});

test('StagedGitWorkspace keeps rejected changes outside the source workspace', () => {
  const source = mkdtempSync(join(tmpdir(), 'open-staged-source-'));
  try {
    git(source, ['init', '--quiet']);
    git(source, ['config', 'user.email', 'test@example.com']);
    git(source, ['config', 'user.name', 'Test']);
    mkdirSync(join(source, 'src'));
    writeFileSync(join(source, 'src', 'backend.ts'), 'export const ready = false;\n');
    git(source, ['add', '.']);
    git(source, ['commit', '--quiet', '-m', 'baseline']);
    const manager = new StagedGitWorkspaceManager();
    const staged = manager.prepare({
      taskId: 'BE-1', attemptId: 'attempt-1', repositoryRoot: source,
      baselineRevision: git(source, ['rev-parse', 'HEAD']).trim(),
    });
    writeFileSync(join(staged.root, 'src', 'backend.ts'), 'export const ready = true;\n');
    writeFileSync(join(staged.root, 'src', 'new.ts'), 'export const staged = true;\n');
    assert.deepEqual(manager.changedPaths(staged), ['src/backend.ts', 'src/new.ts']);
    assert.match(manager.createPatch(staged), /ready = true/);
    manager.verifyPatchIntegrity(staged);
    assert.equal(readFileSync(join(source, 'src', 'backend.ts'), 'utf8'), 'export const ready = false;\n');
    assert.equal(existsSync(join(source, 'src', 'new.ts')), false);
    const stagedRoot = staged.root;
    const receipt = manager.destroy(staged);
    assert.equal(existsSync(stagedRoot), false);
    assert.equal(receipt.sourceWorkspaceMutated, false);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test('VerificationPolicyRegistry binds policy identity and executes fixed argv in a clean environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'open-verification-policy-'));
  try {
    const registry = new VerificationPolicyRegistry();
    const binding = registry.register({
      policyId: 'backend-safe-test', version: '1.0.0', executable: process.execPath,
      args: ['-e', "if(process.env.HOME)process.exit(3);process.stdout.write(process.cwd())"],
      timeoutMs: 1_000, outputLimitBytes: 4_096,
    });
    const evidence = registry.execute(binding, root);
    assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.stdout, realpathSync(root));
    assert.equal(evidence.cleanEnvironment, true);
    assert.throws(() => registry.execute({ ...binding, hash: '0'.repeat(64) }, root), /hash mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ResilientCallExecutor retries bounded transient failures and opens its circuit', async () => {
  assert.equal(isRetryableCallFailure({ success: false, statusCode: 503 }), true);
  assert.equal(isRetryableCallFailure({ success: false, statusCode: 422 }), false);
  let calls = 0;
  const executor = new ResilientCallExecutor(
    { maxAttempts: 3, baseDelayMs: 10 },
    { sleep: async () => undefined, random: () => 1, now: () => 0 },
  );
  const evidence = await executor.execute('hermes:backend', async () => {
    calls += 1;
    return calls < 3 ? { success: false, statusCode: 503 } : { success: true, value: 'ok' };
  });
  assert.equal(evidence.attempts, 3);
  assert.deepEqual(evidence.delaysMs, [10, 20]);

  const budget = new ResilientCallExecutor(
    { maxAttempts: 2, baseDelayMs: 100, retryBudgetMs: 50 },
    { sleep: async () => undefined, random: () => 1, now: () => 0 },
  );
  await assert.rejects(
    budget.execute('hermes:budget', async () => ({ success: false, statusCode: 503 })),
    ResilienceRejectedError,
  );
});

test('ResilientCallExecutor uses only an explicit isolated fallback for retryable infrastructure failure', async () => {
  type Result = { success: boolean; statusCode?: number; value?: string };
  const executor = new ResilientCallExecutor(
    { maxAttempts: 1 },
    { sleep: async () => undefined, random: () => 1, now: () => 0 },
  );
  const evidence = await executor.executeWithFallback<Result>(
    'model:primary', async () => ({ success: false, statusCode: 503 }),
    { policyId: 'server-fallback-v1', key: 'model:fallback', operation: async () => ({ success: true, value: 'ok' }) },
  );
  assert.equal(evidence.route, 'fallback');
  assert.equal(evidence.policyId, 'server-fallback-v1');
  const business = await executor.executeWithFallback<Result>(
    'model:business', async () => ({ success: false, statusCode: 422 }),
    { policyId: 'server-fallback-v1', key: 'model:unused', operation: async () => ({ success: true }) },
  );
  assert.equal(business.route, 'primary');
  await assert.rejects(
    executor.executeWithFallback<Result>(
      'model:same', async () => ({ success: false, statusCode: 503 }),
      { policyId: 'server-fallback-v1', key: 'model:same', operation: async () => ({ success: true }) },
    ), /distinct/,
  );
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
