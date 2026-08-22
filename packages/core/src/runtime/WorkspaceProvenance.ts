import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isManagedPathAllowed } from './ManagedAllowedPaths.js';

export interface WorkspaceProvenanceInput {
  workspaceRoot: string;
  allowedPaths: string[];
  baselineRevision: string;
  workspaceFingerprintBefore: string;
}

export type SensitiveFindingType =
  | 'sensitive_path'
  | 'private_key'
  | 'credential_assignment'
  | 'provider_token';

export interface SensitiveFinding {
  path: string;
  type: SensitiveFindingType;
}

export interface WorkspaceProvenance {
  repositoryRoot: string;
  baselineRevision: string;
  currentRevision: string;
  porcelainStatus: string[];
  changedPaths: string[];
  unifiedDiff: string;
  diffSha256: string;
  diffRedacted: boolean;
  workspaceFingerprint: string;
  workspaceFingerprintMatchesBefore: boolean;
  outOfScopePaths: string[];
  sensitiveFindings: SensitiveFinding[];
  /** Content-only fingerprints for every tracked or untracked workspace path. */
  fileFingerprints: Record<string, string>;
}

interface CommandResult {
  stdout: string;
  status: number;
}

function runGit(cwd: string, args: string[], acceptedStatuses: number[] = [0]): CommandResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const status = result.status ?? -1;
  if (result.error || !acceptedStatuses.includes(status)) {
    const message = result.error?.message || String(result.stderr || '').trim() || `git exited with ${status}`;
    throw new Error(`Unable to collect workspace provenance: ${message}`);
  }
  return { stdout: result.stdout || '', status };
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function toRepositoryPath(path: string): string {
  return path.split(sep).join(posix.sep).replace(/^\.\//, '');
}

function parsePorcelain(output: string): Array<{ display: string; path: string }> {
  const records = output.split('\0').filter(Boolean);
  const parsed: Array<{ display: string; path: string }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (status.includes('R') || status.includes('C')) index += 1;
    parsed.push({ display: `${status} ${path}`, path });
  }
  return parsed;
}

function parseDiffPaths(output: string): string[] {
  const tokens = output.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const firstPath = tokens[index++];
    if (!firstPath) break;
    paths.push(firstPath);
    if (status.startsWith('R') || status.startsWith('C')) {
      const secondPath = tokens[index++];
      if (secondPath) paths.push(secondPath);
    }
  }
  return paths;
}

function fileFingerprint(repositoryRoot: string, path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  try {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return `symlink:${sha256(readlinkSync(absolutePath))}`;
    if (!stat.isFile()) return `other:${stat.mode}`;
    return `file:${sha256(readFileSync(absolutePath))}`;
  } catch {
    return 'deleted';
  }
}

const SENSITIVE_PATH = /(^|\/)(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|[^/]+\.(?:pem|key|p12|pfx))$/i;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
const PROVIDER_TOKEN = /(?:AKIA|ASIA)[A-Z0-9]{16}|gh[oprsu]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}/;
const CREDENTIAL_ASSIGNMENT = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*["']?[A-Za-z0-9_\-\/+.=]{8,}/i;

function findingTypes(path: string, content: string): SensitiveFindingType[] {
  const types: SensitiveFindingType[] = [];
  if (SENSITIVE_PATH.test(path)) types.push('sensitive_path');
  if (PRIVATE_KEY.test(content)) types.push('private_key');
  if (CREDENTIAL_ASSIGNMENT.test(content)) types.push('credential_assignment');
  if (PROVIDER_TOKEN.test(content)) types.push('provider_token');
  return types;
}

function collectSensitiveFindings(
  repositoryRoot: string,
  baselineRevision: string,
  changedPaths: string[],
): SensitiveFinding[] {
  const findings = new Map<string, SensitiveFinding>();
  for (const path of changedPaths) {
    let currentContent = '';
    try {
      const stat = lstatSync(resolve(repositoryRoot, path));
      if (stat.isFile()) currentContent = readFileSync(resolve(repositoryRoot, path), 'utf8');
    } catch {
      // Deleted paths are inspected from the baseline below.
    }
    const baselineContent = runGit(
      repositoryRoot,
      ['show', `${baselineRevision}:${path}`],
      [0, 128],
    ).stdout;
    for (const type of findingTypes(path, `${baselineContent}\n${currentContent}`)) {
      findings.set(`${path}\0${type}`, { path, type });
    }
  }
  return [...findings.values()];
}

function redactDiff(
  diff: string,
  initiallySensitivePaths: Set<string>,
): { content: string; findings: SensitiveFinding[]; redacted: boolean } {
  let currentPath = '';
  let redactWholeFile = false;
  let redacted = false;
  const findings = new Map<string, SensitiveFinding>();
  const output = diff.split('\n').map((line) => {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentPath = match?.[2] || '';
      redactWholeFile = initiallySensitivePaths.has(currentPath);
    }
    const body = line.startsWith('+') || line.startsWith('-') ? line.slice(1) : '';
    const types = currentPath ? findingTypes(currentPath, body) : [];
    for (const type of types) findings.set(`${currentPath}\0${type}`, { path: currentPath, type });
    if (types.includes('private_key')) redactWholeFile = true;
    const isContentLine = (line.startsWith('+') && !line.startsWith('+++'))
      || (line.startsWith('-') && !line.startsWith('---'));
    if (isContentLine && (redactWholeFile || types.length > 0)) {
      redacted = true;
      return `${line[0]}[REDACTED]`;
    }
    return line;
  });
  return { content: output.join('\n'), findings: [...findings.values()], redacted };
}

function untrackedDiff(repositoryRoot: string, paths: string[]): string {
  return paths.map((path) => runGit(
    repositoryRoot,
    ['diff', '--no-index', '--binary', '--full-index', '--', '/dev/null', path],
    [0, 1],
  ).stdout).join('');
}

export function collectWorkspaceProvenance(
  input: WorkspaceProvenanceInput,
): WorkspaceProvenance {
  const requestedRoot = realpathSync(resolve(input.workspaceRoot));
  const repositoryRoot = realpathSync(runGit(requestedRoot, ['rev-parse', '--show-toplevel']).stdout.trim());
  const relativeRoot = relative(repositoryRoot, requestedRoot);
  if (relativeRoot && (relativeRoot.startsWith('..') || relativeRoot.startsWith(sep))) {
    throw new Error('Workspace root is outside the resolved Git repository');
  }

  if (!input.baselineRevision.trim()) {
    throw new Error('Unable to collect workspace provenance: baseline revision is required');
  }
  const resolvedBaselineRevision = runGit(
    repositoryRoot,
    ['rev-parse', '--verify', '--end-of-options', `${input.baselineRevision}^{commit}`],
  ).stdout.trim();
  const currentRevision = runGit(repositoryRoot, ['rev-parse', 'HEAD']).stdout.trim();
  const porcelain = parsePorcelain(runGit(
    repositoryRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
  ).stdout);
  const untrackedPaths = porcelain.filter(({ display }) => display.startsWith('?? ')).map(({ path }) => path);
  const trackedDiff = runGit(repositoryRoot, [
    'diff', '--binary', '--full-index', '--no-ext-diff', resolvedBaselineRevision, '--',
  ]).stdout;
  const rawDiff = `${trackedDiff}${untrackedDiff(repositoryRoot, untrackedPaths)}`;

  const diffPaths = parseDiffPaths(runGit(repositoryRoot, [
    'diff', '--name-status', '-z', '--find-renames', resolvedBaselineRevision, '--',
  ]).stdout);
  const changedPaths = [...new Set([...diffPaths, ...untrackedPaths])].sort();
  const sensitivePaths = new Set(changedPaths.filter((path) => SENSITIVE_PATH.test(path)));
  const scannedFindings = collectSensitiveFindings(repositoryRoot, resolvedBaselineRevision, changedPaths);
  const safeDiff = scannedFindings.length > 0
    ? { content: '[REDACTED]\n', findings: scannedFindings, redacted: true }
    : redactDiff(rawDiff, sensitivePaths);
  for (const path of sensitivePaths) {
    safeDiff.findings.push({ path, type: 'sensitive_path' });
  }
  const sensitiveFindings = [...new Map(
    safeDiff.findings.map((finding) => [`${finding.path}\0${finding.type}`, finding]),
  ).values()].sort((left, right) => `${left.path}\0${left.type}`.localeCompare(`${right.path}\0${right.type}`));

  const workspacePaths = [...new Set(runGit(repositoryRoot, [
    'ls-files', '-z', '--cached', '--others', '--exclude-standard',
  ]).stdout.split('\0').filter(Boolean))].sort();
  const fileFingerprints = Object.fromEntries(
    workspacePaths.map((path) => [path, fileFingerprint(repositoryRoot, path)]),
  );
  const fingerprintSource = JSON.stringify({
    currentRevision,
    status: porcelain.map(({ display }) => display).sort(),
    files: Object.entries(fileFingerprints),
  });
  const workspaceFingerprint = sha256(fingerprintSource);

  return {
    repositoryRoot,
    baselineRevision: resolvedBaselineRevision,
    currentRevision,
    porcelainStatus: porcelain.map(({ display }) => display),
    changedPaths,
    unifiedDiff: safeDiff.content,
    diffSha256: sha256(safeDiff.content),
    diffRedacted: safeDiff.redacted,
    workspaceFingerprint,
    workspaceFingerprintMatchesBefore: workspaceFingerprint === input.workspaceFingerprintBefore,
    outOfScopePaths: changedPaths.filter((path) => !isManagedPathAllowed(path, input.allowedPaths)),
    sensitiveFindings,
    fileFingerprints,
  };
}
