import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

export interface VerificationPolicySpec {
  policyId: string;
  version: string;
  executable: string;
  args: string[];
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface VerificationPolicyBinding {
  policyId: string;
  version: string;
  hash: string;
}

export interface ServerVerificationEvidence {
  policy: VerificationPolicyBinding;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  cwdPolicy: 'verification-worktree-root';
  cleanEnvironment: true;
}

export class VerificationPolicyRegistry {
  private readonly policies = new Map<string, Readonly<VerificationPolicySpec>>();

  register(spec: VerificationPolicySpec): VerificationPolicyBinding {
    validatePolicy(spec);
    const normalized = Object.freeze({ ...spec, args: Object.freeze([...spec.args]) }) as Readonly<VerificationPolicySpec>;
    const binding = bindingFor(normalized);
    const key = policyKey(binding.policyId, binding.version);
    const existing = this.policies.get(key);
    if (existing && bindingFor(existing).hash !== binding.hash) {
      throw new Error(`Verification policy ${key} is already registered with different content`);
    }
    this.policies.set(key, normalized);
    return binding;
  }

  bind(policyId: string, version: string): VerificationPolicyBinding {
    const policy = this.policies.get(policyKey(policyId, version));
    if (!policy) throw new Error(`Unknown verification policy ${policyId}@${version}`);
    return bindingFor(policy);
  }

  execute(binding: VerificationPolicyBinding, workspaceRoot: string): ServerVerificationEvidence {
    const policy = this.policies.get(policyKey(binding.policyId, binding.version));
    if (!policy) throw new Error(`Unknown verification policy ${binding.policyId}@${binding.version}`);
    const expected = bindingFor(policy);
    if (binding.hash !== expected.hash) throw new Error(`Verification policy hash mismatch for ${binding.policyId}@${binding.version}`);
    const startedAt = new Date().toISOString();
    const result = spawnSync(policy.executable, [...policy.args], {
      cwd: workspaceRoot,
      shell: false,
      encoding: 'utf8',
      timeout: policy.timeoutMs,
      maxBuffer: policy.outputLimitBytes,
      // Next.js augments ProcessEnv with a required NODE_ENV when Core source is
      // type-checked from Dashboard. The verifier deliberately exposes only
      // this two-key environment, so retain the runtime contract explicitly.
      env: Object.freeze({ LANG: 'C', LC_ALL: 'C' }) as unknown as NodeJS.ProcessEnv,
    });
    const completedAt = new Date().toISOString();
    if (result.error) throw new Error(`Server verification policy failed: ${result.error.message}`);
    const exitCode = result.status ?? -1;
    if (exitCode !== 0) throw new Error(`Server verification policy exited with ${exitCode}`);
    return {
      policy: expected,
      startedAt,
      completedAt,
      exitCode,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      cwdPolicy: 'verification-worktree-root',
      cleanEnvironment: true,
    };
  }
}

function validatePolicy(spec: VerificationPolicySpec): void {
  if (!spec.policyId.trim() || !spec.version.trim()) throw new Error('verification policy id and version are required');
  if (!isAbsolute(spec.executable)) throw new Error('verification policy executable must be an absolute path');
  if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== 'string')) throw new Error('verification policy args must be an argv array');
  if (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > 300_000) throw new Error('verification policy timeoutMs is invalid');
  if (!Number.isSafeInteger(spec.outputLimitBytes) || spec.outputLimitBytes < 1 || spec.outputLimitBytes > 16 * 1024 * 1024) throw new Error('verification policy outputLimitBytes is invalid');
}

function bindingFor(policy: Readonly<VerificationPolicySpec>): VerificationPolicyBinding {
  const body = {
    policyId: policy.policyId,
    version: policy.version,
    executable: policy.executable,
    args: [...policy.args],
    timeoutMs: policy.timeoutMs,
    outputLimitBytes: policy.outputLimitBytes,
  };
  return { policyId: policy.policyId, version: policy.version, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}

function policyKey(policyId: string, version: string): string {
  return `${policyId}@${version}`;
}
