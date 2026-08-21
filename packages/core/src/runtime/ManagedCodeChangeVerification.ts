import {
  ManagedArtifactValidationError,
  type ManagedArtifactEnvelope,
} from './ManagedArtifactContract.js';
import {
  collectWorkspaceProvenance,
} from './WorkspaceProvenance.js';
import { isManagedPathAllowed } from './ManagedAllowedPaths.js';

export interface ManagedWorkspacePolicy {
  workspaceRoot: string;
  baselineRevision: string;
  allowedPaths: string[];
}

export interface ManagedWorkspaceSnapshot {
  repositoryRoot: string;
  baselineRevision: string;
  currentRevision: string;
  allowedPaths: string[];
  workspaceFingerprintBefore: string;
  fileFingerprints: Record<string, string>;
}

export interface ManagedCodeChangeVerification {
  changedPaths: string[];
  diffSha256: string;
  workspaceFingerprintAfter: string;
}

export class ManagedCodeChangeVerificationError extends ManagedArtifactValidationError {
  constructor(
    code:
      | 'ARTIFACT_EMPTY_CHANGESET'
      | 'ARTIFACT_EVIDENCE_UNRESOLVABLE'
      | 'ARTIFACT_STALE_BASELINE'
      | 'ARTIFACT_OUT_OF_SCOPE'
      | 'ARTIFACT_SECRET_DETECTED',
    statusCode: number,
    surfaceId: string,
    issues: string[],
  ) {
    super(code, statusCode, surfaceId, issues);
    this.name = 'ManagedCodeChangeVerificationError';
  }
}

export function captureManagedWorkspaceSnapshot(
  policy: ManagedWorkspacePolicy,
): ManagedWorkspaceSnapshot {
  if (!policy.workspaceRoot?.trim()) throw new Error('workspaceRoot is required');
  if (!policy.baselineRevision?.trim()) throw new Error('baselineRevision is required');
  if (!Array.isArray(policy.allowedPaths) || policy.allowedPaths.length === 0) {
    throw new Error('allowedPaths must contain at least one path');
  }
  const provenance = collectWorkspaceProvenance({
    workspaceRoot: policy.workspaceRoot,
    baselineRevision: policy.baselineRevision,
    allowedPaths: policy.allowedPaths,
    workspaceFingerprintBefore: '',
  });
  return {
    repositoryRoot: provenance.repositoryRoot,
    baselineRevision: provenance.baselineRevision,
    currentRevision: provenance.currentRevision,
    allowedPaths: [...policy.allowedPaths],
    workspaceFingerprintBefore: provenance.workspaceFingerprint,
    fileFingerprints: { ...provenance.fileFingerprints },
  };
}

export function verifyManagedCodeChange(
  snapshot: ManagedWorkspaceSnapshot,
  artifact: ManagedArtifactEnvelope,
): ManagedCodeChangeVerification {
  const surfaceId = artifact.surfaceId || 'unknown';
  const after = collectWorkspaceProvenance({
    workspaceRoot: snapshot.repositoryRoot,
    baselineRevision: snapshot.baselineRevision,
    allowedPaths: snapshot.allowedPaths,
    workspaceFingerprintBefore: snapshot.workspaceFingerprintBefore,
  });
  if (after.currentRevision !== snapshot.currentRevision) {
    throw verificationError(
      'ARTIFACT_STALE_BASELINE',
      409,
      surfaceId,
      ['workspace HEAD changed after the work item was created'],
    );
  }

  const changedPaths = deltaPaths(snapshot.fileFingerprints, after.fileFingerprints);
  if (after.workspaceFingerprintMatchesBefore || changedPaths.length === 0) {
    throw verificationError(
      'ARTIFACT_EMPTY_CHANGESET',
      422,
      surfaceId,
      ['workspace contains no changes produced after the work item snapshot'],
    );
  }

  const outOfScopePaths = changedPaths.filter((path) => !isManagedPathAllowed(path, snapshot.allowedPaths));
  if (outOfScopePaths.length > 0) {
    throw verificationError(
      'ARTIFACT_OUT_OF_SCOPE',
      403,
      surfaceId,
      ['workspace changed paths outside the task scope: ' + outOfScopePaths.join(', ')],
    );
  }

  const sensitivePaths = [...new Set(
    after.sensitiveFindings
      .filter((finding) => changedPaths.includes(finding.path))
      .map((finding) => finding.path),
  )].sort();
  if (sensitivePaths.length > 0) {
    throw verificationError(
      'ARTIFACT_SECRET_DETECTED',
      403,
      surfaceId,
      ['sensitive material detected in changed paths: ' + sensitivePaths.join(', ')],
    );
  }

  const payload = artifact.payload as Record<string, unknown>;
  const evidenceIssues: string[] = [];
  if (payload.baselineRevision !== snapshot.baselineRevision) {
    evidenceIssues.push('payload.baselineRevision does not match the captured baseline');
  }
  if (payload.workspaceFingerprintBefore !== snapshot.workspaceFingerprintBefore) {
    evidenceIssues.push('payload.workspaceFingerprintBefore does not match the captured workspace');
  }
  if (payload.workspaceFingerprintAfter !== after.workspaceFingerprint) {
    evidenceIssues.push('payload.workspaceFingerprintAfter does not match the current workspace');
  }

  const diff = recordValue(payload.diff);
  if (diff?.format !== 'unified') evidenceIssues.push('payload.diff.format must be unified');
  if (diff?.sha256 !== after.diffSha256) {
    evidenceIssues.push('payload.diff.sha256 does not match the current workspace diff');
  }
  if (typeof diff?.storageRef !== 'string' || !diff.storageRef.trim()) {
    evidenceIssues.push('payload.diff.storageRef is required');
  }

  const claimedFiles = Array.isArray(payload.changedFiles)
    ? payload.changedFiles.map(recordValue)
    : [];
  const claimedPaths = claimedFiles
    .map((entry) => typeof entry?.path === 'string' ? entry.path : '')
    .filter(Boolean)
    .sort();
  if (JSON.stringify(claimedPaths) !== JSON.stringify(changedPaths)) {
    evidenceIssues.push('payload.changedFiles paths do not match the workspace delta');
  }
  for (const path of changedPaths) {
    const claim = claimedFiles.find((entry) => entry?.path === path);
    if (!claim) continue;
    const beforeHash = snapshot.fileFingerprints[path];
    const afterHash = after.fileFingerprints[path];
    const operation = fileOperation(beforeHash, afterHash);
    if (claim.operation !== operation) {
      evidenceIssues.push('payload.changedFiles[' + path + '].operation must be ' + operation);
    }
    if (operation === 'added') {
      if (Object.hasOwn(claim, 'beforeHash')) {
        evidenceIssues.push('payload.changedFiles[' + path + '].beforeHash must be omitted for an addition');
      }
      if (claim.afterHash !== afterHash) {
        evidenceIssues.push('payload.changedFiles[' + path + '].afterHash does not match');
      }
    } else if (operation === 'deleted') {
      if (claim.beforeHash !== beforeHash) {
        evidenceIssues.push('payload.changedFiles[' + path + '].beforeHash does not match');
      }
      if (Object.hasOwn(claim, 'afterHash')) {
        evidenceIssues.push('payload.changedFiles[' + path + '].afterHash must be omitted for a deletion');
      }
    } else {
      if (claim.beforeHash !== beforeHash) {
        evidenceIssues.push('payload.changedFiles[' + path + '].beforeHash does not match');
      }
      if (claim.afterHash !== afterHash) {
        evidenceIssues.push('payload.changedFiles[' + path + '].afterHash does not match');
      }
    }
  }

  const scope = recordValue(payload.scope);
  if (
    !Array.isArray(scope?.allowedPaths)
    || JSON.stringify([...scope.allowedPaths].sort()) !== JSON.stringify([...snapshot.allowedPaths].sort())
  ) {
    evidenceIssues.push('payload.scope.allowedPaths does not match the work item scope');
  }
  if (!Array.isArray(scope?.outOfScopePaths) || scope.outOfScopePaths.length !== 0) {
    evidenceIssues.push('payload.scope.outOfScopePaths must be empty');
  }
  const security = recordValue(payload.security);
  if (security?.secretScanStatus !== 'passed') {
    evidenceIssues.push('payload.security.secretScanStatus must be passed');
  }
  if (!Array.isArray(security?.sensitivePathsTouched) || security.sensitivePathsTouched.length !== 0) {
    evidenceIssues.push('payload.security.sensitivePathsTouched must be empty');
  }

  if (evidenceIssues.length > 0) {
    throw verificationError(
      'ARTIFACT_EVIDENCE_UNRESOLVABLE',
      422,
      surfaceId,
      evidenceIssues,
    );
  }
  return {
    changedPaths,
    diffSha256: after.diffSha256,
    workspaceFingerprintAfter: after.workspaceFingerprint,
  };
}

function deltaPaths(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .sort();
}

function fileOperation(
  beforeFingerprint: string | undefined,
  afterFingerprint: string | undefined,
): 'added' | 'modified' | 'deleted' {
  const beforeExists = Boolean(beforeFingerprint && beforeFingerprint !== 'deleted');
  const afterExists = Boolean(afterFingerprint && afterFingerprint !== 'deleted');
  if (!beforeExists && afterExists) return 'added';
  if (beforeExists && !afterExists) return 'deleted';
  return 'modified';
}

function recordValue(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined;
}

function verificationError(
  code: ConstructorParameters<typeof ManagedCodeChangeVerificationError>[0],
  statusCode: number,
  surfaceId: string,
  issues: string[],
): ManagedCodeChangeVerificationError {
  return new ManagedCodeChangeVerificationError(code, statusCode, surfaceId, issues);
}
