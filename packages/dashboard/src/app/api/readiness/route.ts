import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(process.cwd(), '../..');
const DEV_AGENT_BIN = resolve(ROOT, 'dev-agent');

function parseDoctorOutput(stdout: string) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse doctor JSON',
      raw: stdout.slice(0, 4000),
    };
  }
}

export async function GET() {
  try {
    const { stdout } = await execFileAsync(DEV_AGENT_BIN, ['doctor', '--json'], {
      cwd: ROOT,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    const doctor = parseDoctorOutput(stdout);
    return NextResponse.json({
      checkedAt: Date.now(),
      source: './dev-agent doctor --json',
      ...doctor,
    }, { status: doctor.ok ? 200 : 503 });
  } catch (error: any) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    const doctor = stdout ? parseDoctorOutput(stdout) : null;
    return NextResponse.json({
      checkedAt: Date.now(),
      source: './dev-agent doctor --json',
      ok: false,
      error: error instanceof Error ? error.message : 'Readiness check failed',
      stderr: stderr.slice(0, 4000),
      doctor,
    }, { status: 503 });
  }
}
