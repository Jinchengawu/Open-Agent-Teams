import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  ExecutionSandbox, PreparedSandbox, SandboxAttestation, SandboxResult, SandboxSpec,
} from './ExecutionSandbox.js';
import { SandboxAdmissionError, assertSandboxIsolation } from './ExecutionSandbox.js';
import {
  DEFAULT_ARTIFACT_CONTENT_POLICY, DefaultArtifactContentInspector,
  type ArtifactContentInspectionPolicy, type ArtifactContentInspector,
} from './ArtifactContentInspector.js';

const execFileAsync = promisify(execFile);

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  return bytes.length <= maxBytes ? value : bytes.subarray(0, maxBytes).toString('utf8');
}

export interface OciCommandRunner {
  run(command: string, args: string[], options: { timeoutMs: number; maxBuffer: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>; 
  runBinary?(command: string, args: string[], options: { timeoutMs: number; maxBuffer: number }): Promise<{
    stdout: Buffer; stderr: string; exitCode: number;
  }>;
}

const defaultRunner: OciCommandRunner = {
  async run(command, args, options) {
    try {
      const result = await execFileAsync(command, args, {
        timeout: options.timeoutMs, maxBuffer: options.maxBuffer, encoding: 'utf8',
      });
      return {
        stdout: truncateUtf8(result.stdout, options.maxBuffer),
        stderr: truncateUtf8(result.stderr, options.maxBuffer),
        exitCode: 0,
      };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number | string };
      return {
        stdout: truncateUtf8(failure.stdout ?? '', options.maxBuffer),
        stderr: truncateUtf8(failure.stderr ?? String(error), options.maxBuffer),
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
      };
    }
  },
  async runBinary(command, args, options) {
    try {
      const result = await execFileAsync(command, args, { timeout: options.timeoutMs, maxBuffer: options.maxBuffer, encoding: 'buffer' });
      return { stdout: Buffer.from(result.stdout), stderr: Buffer.from(result.stderr).toString('utf8'), exitCode: 0 };
    } catch (error) {
      const failure = error as { stdout?: Buffer; stderr?: Buffer; code?: number | string };
      return { stdout: Buffer.from(failure.stdout ?? []), stderr: Buffer.from(failure.stderr ?? []).toString('utf8'), exitCode: typeof failure.code === 'number' ? failure.code : 1 };
    }
  },
};

interface OciPreparedSandbox extends PreparedSandbox {
  containerName: string;
  storageMeterNonce: string;
}

function requireImageDigest(image: string | undefined): string {
  if (!image || !/@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'OCI imageDigest must be pinned as name@sha256:<64 hex>');
  }
  return image;
}

function validateMount(source: string, target: string): void {
  if (!source.startsWith('/') || !target.startsWith('/')) {
    throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'OCI mount source and target must be absolute');
  }
  if (target === '/' || target.startsWith('/proc') || target.startsWith('/sys') || target.startsWith('/dev')) {
    throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', `unsafe OCI mount target: ${target}`);
  }
}
function validateStorageQuota(spec: SandboxSpec): NonNullable<SandboxSpec['storageQuota']> | undefined {
  const quota = spec.storageQuota;
  if (!quota) return undefined;
  for (const [field, value] of Object.entries(quota).filter(([key]) => ['aggregateWritableBytes', 'tmpBytes', 'outputBytes', 'maxFiles', 'maxFileBytes'].includes(key))) {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', `storageQuota.${field} must be a positive integer`);
  }
  if (quota.outputMode !== 'tmpfs') throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'aggregate writable quota requires a tmpfs output mount');
  if (quota.artifactExport === 'required') {
    if (!Number.isSafeInteger(quota.maxFiles) || quota.maxFiles! <= 0) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'storageQuota.maxFiles is required for artifact export');
    if (!Number.isSafeInteger(quota.maxFileBytes) || quota.maxFileBytes! <= 0 || quota.maxFileBytes! > quota.outputBytes) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'storageQuota.maxFileBytes is invalid');
    if (!quota.allowedExtensions?.length || quota.allowedExtensions.some((value) => !/^\.[a-z0-9]+$/i.test(value))) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'storageQuota.allowedExtensions is required');
  }
  if (quota.tmpBytes + quota.outputBytes > quota.aggregateWritableBytes) {
    throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'storageQuota partition sum exceeds aggregateWritableBytes');
  }
  return quota;
}

/** Rootless-engine-compatible Docker/Podman CLI adapter. Linux evidence is a separate gate. */
export class OciExecutionSandbox implements ExecutionSandbox {
  readonly isolationLevel = 'container' as const;

  constructor(
    private readonly runner: OciCommandRunner = defaultRunner,
    private readonly engine = 'docker',
    private readonly now: () => Date = () => new Date(),
    private readonly exportPolicy?: { allowedRoot: string; contentPolicy?: ArtifactContentInspectionPolicy },
    private readonly contentInspector: ArtifactContentInspector = new DefaultArtifactContentInspector(),
  ) {}

  async prepare(spec: SandboxSpec): Promise<PreparedSandbox> {
    assertSandboxIsolation(this.isolationLevel, spec.minimumIsolation);
    requireImageDigest(spec.imageDigest);
    if (spec.networkPolicy === 'host') {
      throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'host networking is forbidden for OCI Agent tasks');
    }
    if (spec.networkPolicy === 'allowlist') {
      throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'OCI allowlist networking requires an external enforced network policy');
    }
    for (const mount of spec.inputMounts ?? []) validateMount(mount.source, mount.target);
    if (!spec.outputMount) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'OCI outputMount is required');
    validateMount(spec.outputMount.source, spec.outputMount.target);
    const storageQuota = validateStorageQuota(spec);
    if (storageQuota?.artifactExport === 'required') this.validateExportTarget(spec.outputMount.source);
    const id = randomUUID();
    const storageMeterNonce = randomUUID().replaceAll('-', '');
    return {
      id,
      root: spec.outputMount.source,
      containerName: `dat-${spec.taskId.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 32)}-${id.slice(0, 8)}`,
      storageMeterNonce,
      attestation: {
        isolationLevel: 'container', adapter: 'oci-cli/v1', imageDigest: requireImageDigest(spec.imageDigest), taskId: spec.taskId,
        attemptId: spec.attemptId, preparedAt: this.now().toISOString(),
        sourceWorkspaceMutated: false,
        ...(storageQuota ? { storage: {
          aggregateLimitBytes: storageQuota.aggregateWritableBytes,
          tmpLimitBytes: storageQuota.tmpBytes,
          outputLimitBytes: storageQuota.outputBytes,
          aggregateUsedBytes: null,
          enforcement: 'partitioned-tmpfs' as const,
          measurement: 'unavailable' as const,
          artifactExport: storageQuota.artifactExport,
        } } : {}),
        limitations: [
          'Strong-isolation evidence requires a rootless Linux engine and the adversarial CI matrix.',
          ...(storageQuota ? [
            storageQuota.artifactExport === 'required'
              ? 'Aggregate writable storage uses tmpfs and artifacts are exported through a server-validated tar stream before container removal.'
              : 'Aggregate writable storage is enforced as fixed /tmp and output tmpfs partitions; artifact export is disabled.',
          ] : ['diskBytes maps to per-file RLIMIT_FSIZE; aggregate volume quota requires an explicit storageQuota.']),
        ],
      },
    } as OciPreparedSandbox;
  }

  async run(prepared: PreparedSandbox, spec: SandboxSpec): Promise<SandboxResult> {
    assertSandboxIsolation(this.isolationLevel, spec.minimumIsolation);
    const image = requireImageDigest(spec.imageDigest);
    const container = prepared as OciPreparedSandbox;
    const limits = spec.resourceLimits ?? {};
    const storageQuota = validateStorageQuota(spec);
    const args = [
      ...(storageQuota?.artifactExport === 'required' ? ['create'] : ['run', '--rm']), '--name', container.containerName,
      '--read-only', '--user', '65532:65532', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true', '--network', 'none',
      '--tmpfs', `/tmp:rw,noexec,nosuid,nodev,size=${storageQuota?.tmpBytes ?? 67_108_864}`,
      '--workdir', spec.workdir,
    ];
    if (limits.pids !== undefined) args.push('--pids-limit', String(limits.pids));
    if (limits.memoryBytes !== undefined) args.push('--memory', String(limits.memoryBytes));
    if (limits.cpuMillis !== undefined) args.push('--cpus', String(limits.cpuMillis / 1000));
    if (limits.diskBytes !== undefined) args.push('--ulimit', `fsize=${limits.diskBytes}:${limits.diskBytes}`);
    for (const mount of spec.inputMounts ?? []) {
      args.push('--mount', `type=bind,src=${mount.source},dst=${mount.target},readonly`);
    }
    if (!spec.outputMount) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'OCI outputMount is required');
    if (storageQuota) args.push('--mount', `type=tmpfs,dst=${spec.outputMount.target},tmpfs-size=${storageQuota.outputBytes},tmpfs-mode=0700`);
    else args.push('--mount', `type=bind,src=${spec.outputMount.source},dst=${spec.outputMount.target}`);
    if (storageQuota) {
      args.push(image, '/bin/sh', '-c',
        `"$@"; status=$?; tmp_kib=$(du -sk /tmp 2>/dev/null | cut -f1); out_kib=$(du -sk "$DAT_OUTPUT" 2>/dev/null | cut -f1); printf "\\n__DAT_STORAGE_USAGE_${container.storageMeterNonce}_KIB__=%s,%s\\n" "$tmp_kib" "$out_kib" >&2; exit "$status"`,
        'dat-storage-meter', spec.command, ...spec.args);
      const outputEnvIndex = args.indexOf('--workdir');
      args.splice(outputEnvIndex, 0, '--env', `DAT_OUTPUT=${spec.outputMount.target}`);
    } else args.push(image, spec.command, ...spec.args);
    const timeoutMs = Math.max(1, (spec.deadlineAt ?? (Date.now() + 60_000)) - Date.now());
    const maxBuffer = limits.outputBytes ?? 1_000_000;
    let result;
    if (storageQuota?.artifactExport === 'required') {
      const created = await this.runner.run(this.engine, args, { timeoutMs, maxBuffer });
      if (created.exitCode !== 0) return { exitCode: created.exitCode, stdout: created.stdout, stderr: created.stderr, changedPaths: [], attestation: structuredClone(prepared.attestation) };
      result = await this.runner.run(this.engine, ['start', '-a', container.containerName], { timeoutMs, maxBuffer });
    } else result = await this.runner.run(this.engine, args, { timeoutMs, maxBuffer });
    const marker = `__DAT_STORAGE_USAGE_${container.storageMeterNonce}_KIB__`;
    const usage = result.stderr.match(new RegExp(`(?:^|\\n)${marker}=(\\d+),(\\d+)(?:\\n|$)`));
    const stderr = result.stderr.replace(new RegExp(`(?:^|\\n)${marker}=\\d+,\\d+(?:\\n|$)`), '\n');
    const attestation = structuredClone(prepared.attestation);
    if (storageQuota && attestation.storage) {
      if (usage) {
        attestation.storage.aggregateUsedBytes = (Number(usage[1]) + Number(usage[2])) * 1024;
        attestation.storage.measurement = 'du-kib';
        prepared.attestation.storage = structuredClone(attestation.storage);
      } else {
        if (storageQuota.artifactExport === 'required') await this.destroy(prepared);
        return { exitCode: 125, stdout: result.stdout, stderr: `${stderr}\nOCI storage usage measurement unavailable`, changedPaths: [], attestation };
      }
    }
    let changedPaths: string[] = [];
    if (storageQuota?.artifactExport === 'required') {
      if (result.exitCode !== 0) {
        await this.destroy(prepared);
        return { exitCode: result.exitCode, stdout: result.stdout, stderr, changedPaths: [], attestation };
      }
      let exported;
      try { exported = await this.exportArtifacts(container, spec, storageQuota, timeoutMs); }
      catch (error) {
        // exportArtifacts only writes to its server-owned staging directory until
        // validation succeeds. Never delete the requested target here: a raced
        // host path must be preserved rather than mistaken for our partial output.
        await this.destroy(prepared);
        throw error;
      }
      changedPaths = exported.changedPaths;
      attestation.storage!.exportBundleSha256 = exported.sha256;
      attestation.storage!.exportedFiles = exported.files;
      attestation.storage!.exportedBytes = exported.bytes;
      attestation.storage!.inspectedMimeTypes = exported.mimeTypes;
      attestation.storage!.contentPolicySha256 = exported.contentPolicySha256;
      prepared.attestation.storage = structuredClone(attestation.storage);
    }
    return {
      exitCode: result.exitCode, stdout: result.stdout, stderr,
      changedPaths, attestation,
    };
  }

  private validateExportTarget(target: string): void {
    if (!this.exportPolicy?.allowedRoot) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'server-owned OCI export policy is required');
    const root = realpathSync(this.exportPolicy.allowedRoot);
    const resolved = join(realpathSync(dirname(resolve(target))), resolve(target).split(sep).at(-1)!);
    const rel = relative(root, resolved);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'OCI export target is outside the server-owned root');
    if (existsSync(resolved)) throw new SandboxAdmissionError('SANDBOX_SPEC_INVALID', 'OCI export target must not already exist');
  }

  private async exportArtifacts(container: OciPreparedSandbox, spec: SandboxSpec, quota: NonNullable<SandboxSpec['storageQuota']>, timeoutMs: number): Promise<{ changedPaths: string[]; sha256: string; files: number; bytes: number; mimeTypes: string[]; contentPolicySha256: string }> {
    if (!this.runner.runBinary) throw new Error('OCI binary tar export port is unavailable');
    this.validateExportTarget(spec.outputMount!.source);
    // `start -a` has already waited for the task container to stop. `docker cp`
    // is deliberately used here because it can archive a stopped container;
    // `docker exec ... tar` cannot and would make successful export impossible.
    const archiveSource = `${container.containerName}:${spec.outputMount!.target.replace(/\/$/, '')}/.`;
    const tar = await this.runner.runBinary(this.engine, ['cp', archiveSource, '-'], { timeoutMs, maxBuffer: quota.outputBytes + 1_048_576 });
    if (tar.exitCode !== 0) throw new Error(`OCI docker cp artifact export failed: ${truncateUtf8(tar.stderr, 1024) || 'unknown copy error'}`);
    const contentPolicy = this.exportPolicy?.contentPolicy ?? DEFAULT_ARTIFACT_CONTENT_POLICY;
    const entries = parseValidatedTar(tar.stdout, { maxFiles: quota.maxFiles!, maxFileBytes: quota.maxFileBytes!, maxTotalBytes: quota.outputBytes, allowedExtensions: quota.allowedExtensions! }, this.contentInspector, contentPolicy);
    const target = resolve(spec.outputMount!.source);
    const stage = `${target}.export-${randomUUID()}`;
    rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true, mode: 0o700 });
    try {
      for (const entry of entries) {
        const destination = join(stage, entry.path); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 }); writeFileSync(destination, entry.data, { mode: 0o600, flag: 'wx' });
      }
      renameSync(stage, target);
    } catch (error) { rmSync(stage, { recursive: true, force: true }); throw error; }
    return { changedPaths: entries.map((entry) => entry.path), sha256: createHash('sha256').update(tar.stdout).digest('hex'), files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.data.length, 0), mimeTypes: [...new Set(entries.map((entry) => entry.mimeType))].sort(), contentPolicySha256: createHash('sha256').update(JSON.stringify([...contentPolicy.allowedMimeTypes].sort())).digest('hex') };
  }

  async terminate(prepared: PreparedSandbox): Promise<void> {
    const container = prepared as OciPreparedSandbox;
    await this.runner.run(this.engine, ['kill', container.containerName], { timeoutMs: 5_000, maxBuffer: 64_000 });
  }

  async destroy(prepared: PreparedSandbox): Promise<SandboxAttestation> {
    const container = prepared as OciPreparedSandbox;
    await this.runner.run(this.engine, ['rm', '-f', container.containerName], { timeoutMs: 5_000, maxBuffer: 64_000 });
    const remaining = await this.runner.run(
      this.engine,
      ['inspect', container.containerName],
      { timeoutMs: 5_000, maxBuffer: 64_000 },
    );
    if (remaining.exitCode === 0) {
      throw new Error(`OCI cleanup verification failed: container ${container.containerName} still exists`);
    }
    if (!/no such (?:object|container)/i.test(remaining.stderr)) {
      throw new Error(
        `OCI cleanup verification could not prove container removal: ${remaining.stderr || 'unknown engine error'}`,
      );
    }
    const storage = prepared.attestation.storage;
    return {
      ...structuredClone(prepared.attestation), destroyedAt: this.now().toISOString(),
      cleanupReceipt: `oci-container-removed:${container.containerName}${storage ? `;storage=partitioned-tmpfs;limit=${storage.aggregateLimitBytes};used=${storage.aggregateUsedBytes ?? 'unknown'}${storage.exportBundleSha256 ? `;exportSha256=${storage.exportBundleSha256};files=${storage.exportedFiles};bytes=${storage.exportedBytes}` : ''}` : ''}`,
    };
  }
}

interface ValidatedTarEntry { path: string; data: Buffer; mimeType: string }
function parseValidatedTar(buffer: Buffer, policy: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; allowedExtensions: string[] }, inspector: ArtifactContentInspector, contentPolicy: ArtifactContentInspectionPolicy): ValidatedTarEntry[] {
  const entries: ValidatedTarEntry[] = []; let offset = 0; let total = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512); offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 48);
    const sizeText = tarString(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || size > policy.maxFileBytes) throw new Error('OCI export entry exceeds single-file limit');
    if (type === '5') { offset += Math.ceil(size / 512) * 512; continue; }
    if (type !== '0' && type !== '\0') throw new Error('OCI export links and special files are forbidden');
    const normalized = path.replace(/^\.\//, '');
    if (!normalized || normalized.includes('\0') || isAbsolute(normalized) || normalized.split('/').some((part) => part === '..' || part === '')) throw new Error('OCI export path escapes target');
    if (!policy.allowedExtensions.includes(extname(normalized).toLowerCase())) throw new Error('OCI export file type is not allowed');
    if (entries.some((entry) => entry.path === normalized)) throw new Error('OCI export contains duplicate paths');
    if (++total > policy.maxFiles) throw new Error('OCI export exceeds file-count limit');
    const data = buffer.subarray(offset, offset + size);
    if (data.length !== size) throw new Error('OCI export tar is truncated');
    const bytes = entries.reduce((sum, entry) => sum + entry.data.length, 0) + size;
    if (bytes > policy.maxTotalBytes) throw new Error('OCI export exceeds aggregate byte limit');
    const stableData = Buffer.from(data);
    const inspection = inspector.inspect(normalized, stableData, contentPolicy);
    if (!contentPolicy.allowedMimeTypes.includes(inspection.mimeType)) throw new Error('OCI export inspector returned MIME outside server policy');
    entries.push({ path: normalized, data: stableData, mimeType: inspection.mimeType }); offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}
function tarString(value: Buffer): string { return value.subarray(0, value.indexOf(0) < 0 ? value.length : value.indexOf(0)).toString('utf8'); }
