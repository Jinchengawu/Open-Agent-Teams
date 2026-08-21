import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MicroVmProbeCommandRunner {
  run(command: string, args: string[], options: { timeoutMs: number }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    cleanupVerified: boolean;
  }>;
}

export interface MicroVmProbeReceipt {
  adapter: 'qemu-kvm-probe/v1';
  kvmAvailable: true;
  probedAt: string;
  receipt: string;
  cleanupReceipt: string;
  limitations: string[];
}

export class KvmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KvmUnavailableError';
  }
}

const defaultRunner: MicroVmProbeCommandRunner = {
  async run(command, args, options) {
    try {
      const result = await execFileAsync(command, args, { timeout: options.timeoutMs, encoding: 'utf8' });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, cleanupVerified: true };
    } catch (error) {
      const failure = error as { killed?: boolean; stdout?: string; stderr?: string; code?: number };
      return {
        exitCode: failure.killed ? 124 : typeof failure.code === 'number' ? failure.code : 1,
        stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', cleanupVerified: failure.killed === true,
      };
    }
  },
};

/** KVM/QEMU availability spike. This is not an ExecutionSandbox implementation. */
export class QemuKvmRuntimeProbe {
  constructor(
    private readonly runner: MicroVmProbeCommandRunner = defaultRunner,
    private readonly now: () => Date = () => new Date(),
    private readonly environment: { linux: boolean; kvmDevice: boolean } = {
      linux: process.platform === 'linux', kvmDevice: existsSync('/dev/kvm'),
    },
  ) {}

  async probe(): Promise<MicroVmProbeReceipt> {
    if (!this.environment.linux || !this.environment.kvmDevice) {
      throw new KvmUnavailableError('Linux /dev/kvm is required for microVM evidence');
    }
    const result = await this.runner.run('qemu-system-x86_64', [
      '-machine', 'accel=kvm', '-cpu', 'host', '-m', '64', '-smp', '1',
      '-nodefaults', '-display', 'none', '-S',
    ], { timeoutMs: 1_500 });
    // A timeout is success: QEMU created the VM and remained paused at -S.
    if (result.exitCode !== 124 || !result.cleanupVerified) {
      throw new KvmUnavailableError(`QEMU could not create a KVM VM: ${sanitize(result.stderr)}`);
    }
    const probedAt = this.now().toISOString();
    return {
      adapter: 'qemu-kvm-probe/v1', kvmAvailable: true, probedAt,
      receipt: `qemu-kvm-created-and-paused:${probedAt}`,
      cleanupReceipt: `qemu-process-timeout-reaped:${probedAt}`,
      limitations: [
        'Probe proves KVM VM creation only; it does not execute an Agent workload.',
        'Guest boot, network, mounts, credentials, resource enforcement and cleanup need a production microVM adapter.',
      ],
    };
  }
}

function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 500) || 'unknown QEMU failure';
}
