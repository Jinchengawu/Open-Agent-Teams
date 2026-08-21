export type SandboxIsolationLevel = 'local-policy' | 'container' | 'microvm';

export interface SandboxResourceLimits {
  cpuMillis?: number;
  memoryBytes?: number;
  pids?: number;
  diskBytes?: number;
  outputBytes?: number;
}

export interface SandboxSpec {
  taskId: string;
  attemptId: string;
  command: string;
  args: string[];
  workdir: string;
  deadlineAt?: number;
  networkPolicy: 'none' | 'allowlist' | 'host';
  resourceLimits?: SandboxResourceLimits;
  credentialRefs?: string[];
  minimumIsolation: SandboxIsolationLevel;
  /** OCI/microVM adapters require immutable image identity. */
  imageDigest?: string;
  inputMounts?: Array<{ source: string; target: string }>;
  outputMount?: { source: string; target: string };
  /** Aggregate writable storage is partitioned across tmpfs mounts; their sum cannot exceed this limit. */
  storageQuota?: {
    aggregateWritableBytes: number;
    tmpBytes: number;
    outputBytes: number;
    outputMode: 'tmpfs' | 'bind';
    /** `required` uses the server-owned bounded export path; `disabled` keeps output evidence-only. */
    artifactExport: 'disabled' | 'required';
    maxFiles?: number;
    maxFileBytes?: number;
    allowedExtensions?: string[];
  };
}

export interface SandboxAttestation {
  isolationLevel: SandboxIsolationLevel;
  adapter: string;
  imageDigest?: string;
  taskId: string;
  attemptId: string;
  preparedAt: string;
  destroyedAt?: string;
  sourceWorkspaceMutated: boolean;
  cleanupReceipt?: string;
  limitations: string[];
  storage?: {
    aggregateLimitBytes: number;
    tmpLimitBytes: number;
    outputLimitBytes: number;
    aggregateUsedBytes: number | null;
    enforcement: 'partitioned-tmpfs';
    measurement: 'du-kib' | 'unavailable';
    artifactExport: 'disabled' | 'required';
    exportBundleSha256?: string;
    exportedFiles?: number;
    exportedBytes?: number;
    inspectedMimeTypes?: string[];
    contentPolicySha256?: string;
  };
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  changedPaths: string[];
  attestation: SandboxAttestation;
}

export interface PreparedSandbox {
  readonly id: string;
  readonly root: string;
  readonly attestation: SandboxAttestation;
}

export interface ExecutionSandbox {
  readonly isolationLevel: SandboxIsolationLevel;
  prepare(spec: SandboxSpec): Promise<PreparedSandbox>;
  run(prepared: PreparedSandbox, spec: SandboxSpec): Promise<SandboxResult>;
  terminate(prepared: PreparedSandbox, reason?: string): Promise<void>;
  destroy(prepared: PreparedSandbox): Promise<SandboxAttestation>;
}

export class SandboxAdmissionError extends Error {
  constructor(
    readonly code: 'SANDBOX_ISOLATION_INSUFFICIENT' | 'SANDBOX_SPEC_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'SandboxAdmissionError';
  }
}

const ISOLATION_RANK: Record<SandboxIsolationLevel, number> = {
  'local-policy': 0,
  container: 1,
  microvm: 2,
};

export function assertSandboxIsolation(
  actual: SandboxIsolationLevel,
  minimum: SandboxIsolationLevel,
): void {
  if (ISOLATION_RANK[actual] < ISOLATION_RANK[minimum]) {
    throw new SandboxAdmissionError(
      'SANDBOX_ISOLATION_INSUFFICIENT',
      `Sandbox isolation ${actual} does not satisfy required level ${minimum}`,
    );
  }
}
