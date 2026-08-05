import { createHash } from 'node:crypto';

export interface CommandEvidence {
  command: string;
  exitCode: number;
  output?: string;
}

export interface TestEvidence extends CommandEvidence {
  passed: boolean;
  name?: string;
}

export interface ManagedArtifactEnvelope {
  schemaVersion: 'productive-delivery-artifact/v1';
  artifactId: string;
  kind: string;
  deliveryRunId: string;
  pipelineInstanceId: string;
  surfaceId: string;
  taskId: string;
  attemptId: string;
  producer: {
    agentId: string;
    executionMode: string;
    workerId: string;
  };
  contentHash: string;
  summary?: string;
  acceptanceIds?: string[];
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ManagedArtifactValidation {
  valid: boolean;
  issues: string[];
  code?: 'ARTIFACT_CONTRACT_INVALID' | 'ARTIFACT_BINDING_MISMATCH';
}

export class ManagedArtifactValidationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly surfaceId: string,
    readonly issues: string[],
  ) {
    super(`${code} for ${surfaceId}: ${issues.join('; ')}`);
    this.name = 'ManagedArtifactValidationError';
  }
}

export class ManagedArtifactContractError extends ManagedArtifactValidationError {
  constructor(
    surfaceId: string,
    issues: string[],
  ) {
    super('ARTIFACT_CONTRACT_INVALID', 422, surfaceId, issues);
    this.name = 'ManagedArtifactContractError';
  }
}

export class ManagedArtifactBindingError extends ManagedArtifactValidationError {
  constructor(surfaceId: string, issues: string[]) {
    super('ARTIFACT_BINDING_MISMATCH', 409, surfaceId, issues);
    this.name = 'ManagedArtifactBindingError';
  }
}

export class ManagedArtifactIdempotencyConflictError extends ManagedArtifactValidationError {
  constructor(surfaceId: string, issues: string[]) {
    super('ARTIFACT_IDEMPOTENCY_CONFLICT', 409, surfaceId, issues);
    this.name = 'ManagedArtifactIdempotencyConflictError';
  }
}

export class ManagedArtifactAcceptanceError extends ManagedArtifactValidationError {
  constructor(surfaceId: string, issues: string[]) {
    super('ARTIFACT_ACCEPTANCE_UNMAPPED', 422, surfaceId, issues);
    this.name = 'ManagedArtifactAcceptanceError';
  }
}

export class ManagedArtifactTaskScopeError extends ManagedArtifactValidationError {
  constructor(surfaceId: string, issues: string[]) {
    super('ARTIFACT_OUT_OF_SCOPE', 403, surfaceId, issues);
    this.name = 'ManagedArtifactTaskScopeError';
  }
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStableTaskId(value: unknown): value is string {
  return isNonEmptyString(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  return !value.split(/[\\/]/).some((segment) => segment === '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function hasDependencyCycle(tasks: Array<{ id: string; dependsOn: string[] }>): boolean {
  const dependencies = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const dependencyId of dependencies.get(taskId) ?? []) {
      if (visit(dependencyId)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  return tasks.some((task) => visit(task.id));
}

export function validateManagedArtifactEnvelope(
  surfaceId: string,
  artifact: ManagedArtifactEnvelope | undefined,
  binding?: {
    sessionId?: string;
    taskId?: string;
    attemptId?: string;
    agentId?: string;
    workerId?: string;
  },
): ManagedArtifactValidation {
  if (!artifact || typeof artifact !== 'object' || typeof artifact.kind !== 'string') {
    return { valid: false, issues: ['artifact envelope with kind is required'] };
  }

  const issues: string[] = [];
  if (artifact.schemaVersion !== 'productive-delivery-artifact/v1') {
    issues.push('schemaVersion must be productive-delivery-artifact/v1');
  }
  if (!artifact.artifactId?.trim()) issues.push('artifactId is required');
  if (typeof artifact.deliveryRunId !== 'string' || !artifact.deliveryRunId.trim()) {
    issues.push('deliveryRunId is required');
  }
  if (typeof artifact.pipelineInstanceId !== 'string' || !artifact.pipelineInstanceId.trim()) {
    issues.push('pipelineInstanceId is required');
  }
  if (typeof artifact.taskId !== 'string' || !artifact.taskId.trim()) issues.push('taskId is required');
  if (typeof artifact.attemptId !== 'string' || !artifact.attemptId.trim()) issues.push('attemptId is required');
  if (!artifact.producer || typeof artifact.producer !== 'object') {
    issues.push('producer is required');
  } else {
    if (typeof artifact.producer.agentId !== 'string' || !artifact.producer.agentId.trim()) {
      issues.push('producer.agentId is required');
    }
    if (typeof artifact.producer.executionMode !== 'string' || !artifact.producer.executionMode) {
      issues.push('producer.executionMode is required');
    }
    if (typeof artifact.producer.workerId !== 'string' || !artifact.producer.workerId.trim()) {
      issues.push('producer.workerId is required');
    }
  }
  if (artifact.surfaceId !== surfaceId) issues.push(`surfaceId must be ${surfaceId}`);
  if (typeof artifact.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.contentHash)) {
    issues.push('contentHash must be a lowercase SHA-256 hex digest');
  }
  if (!artifact.payload || typeof artifact.payload !== 'object' || Array.isArray(artifact.payload)) {
    issues.push('payload object is required');
  }
  const payload = artifact.payload || {};
  if (issues.length > 0) return { valid: false, issues, code: 'ARTIFACT_CONTRACT_INVALID' };

  const bindingIssues: string[] = [];
  if (binding?.sessionId && artifact.deliveryRunId !== binding.sessionId) {
    bindingIssues.push('deliveryRunId does not match work item sessionId');
  }
  if (binding?.sessionId && artifact.pipelineInstanceId !== binding.sessionId) {
    bindingIssues.push('pipelineInstanceId does not match work item sessionId');
  }
  if (binding?.taskId && artifact.taskId !== binding.taskId) {
    bindingIssues.push('taskId does not match work item taskId');
  }
  if (binding?.attemptId && artifact.attemptId !== binding.attemptId) {
    bindingIssues.push('attemptId does not match work item attemptId');
  }
  if (binding?.agentId && artifact.producer.agentId !== binding.agentId) {
    bindingIssues.push('producer.agentId does not match work item agentId');
  }
  if (artifact.producer.executionMode !== 'managed-external') {
    bindingIssues.push('producer.executionMode must be managed-external');
  }
  if (binding?.workerId && artifact.producer.workerId !== binding.workerId) {
    bindingIssues.push('producer.workerId does not match submitting workerId');
  }
  if (bindingIssues.length > 0) {
    return { valid: false, issues: bindingIssues, code: 'ARTIFACT_BINDING_MISMATCH' };
  }

  const stageIssues: string[] = [];
  if (surfaceId === 'discovery') {
    if (artifact.kind !== 'prd') stageIssues.push('kind must be prd');
    if (!nonEmptyStrings(artifact.acceptanceIds)) stageIssues.push('acceptanceIds must contain at least one ID');
  } else if (surfaceId === 'planning') {
    if (artifact.kind !== 'task_graph') stageIssues.push('kind must be task_graph');
    if (!isNonEmptyString(payload.title)) stageIssues.push('payload.title is required');
    if (!isNonEmptyString(payload.sourcePrdArtifactId)) {
      stageIssues.push('payload.sourcePrdArtifactId is required');
    }
    if (typeof payload.sourcePrdContentHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(payload.sourcePrdContentHash)) {
      stageIssues.push('payload.sourcePrdContentHash must be a lowercase SHA-256 hex digest');
    }
    if (!payload.milestone || typeof payload.milestone !== 'object' || Array.isArray(payload.milestone)) {
      stageIssues.push('payload.milestone object is required');
    }
    if (!nonEmptyStrings(artifact.acceptanceIds)) {
      stageIssues.push('acceptanceIds must contain at least one ID');
    }
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : undefined;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      stageIssues.push('taskGraph.tasks must contain at least one task');
    } else {
      const normalizedTasks: Array<{ id: string; dependsOn: string[] }> = [];
      const taskIds = new Set<string>();
      const acceptanceIds = new Set(artifact.acceptanceIds ?? []);

      for (const task of tasks) {
        if (!task || typeof task !== 'object' || Array.isArray(task)) {
          stageIssues.push('each taskGraph task must be an object');
          continue;
        }
        const candidate = task as Record<string, unknown>;
        if (!isStableTaskId(candidate.id)) {
          stageIssues.push('each taskGraph task requires a stable id');
          continue;
        }
        if (taskIds.has(candidate.id)) stageIssues.push(`duplicate task id: ${candidate.id}`);
        taskIds.add(candidate.id);
        if (!isNonEmptyString(candidate.title)) stageIssues.push(`task ${candidate.id} requires title`);
        if (!isNonEmptyString(candidate.ownerAgent)) {
          stageIssues.push(`task ${candidate.id} requires ownerAgent`);
        }
        if (!nonEmptyStrings(candidate.acceptanceIds)) {
          stageIssues.push(`task ${candidate.id} acceptanceIds must contain at least one ID`);
        } else if (candidate.acceptanceIds.some((id) => !acceptanceIds.has(id))) {
          stageIssues.push(`task ${candidate.id} contains an unknown acceptanceId`);
        }
        if (!Array.isArray(candidate.dependsOn)
          || candidate.dependsOn.some((id) => !isNonEmptyString(id))) {
          stageIssues.push(`task ${candidate.id} dependsOn must be an array of task IDs`);
        }
        if (!isNonEmptyString(candidate.expectedArtifactKind)) {
          stageIssues.push(`task ${candidate.id} requires expectedArtifactKind`);
        }
        if (typeof candidate.expectedMutation !== 'boolean') {
          stageIssues.push(`task ${candidate.id} expectedMutation must be boolean`);
        }
        if (!nonEmptyStrings(candidate.allowedPaths)
          || candidate.allowedPaths.some((allowedPath) => !isSafeRelativePath(allowedPath))) {
          stageIssues.push(`task ${candidate.id} allowedPaths must contain safe relative paths`);
        }
        if (Array.isArray(candidate.dependsOn)
          && candidate.dependsOn.every((id) => isNonEmptyString(id))) {
          normalizedTasks.push({ id: candidate.id, dependsOn: candidate.dependsOn as string[] });
        }
      }

      for (const task of normalizedTasks) {
        const uniqueDependencies = new Set(task.dependsOn);
        if (uniqueDependencies.size !== task.dependsOn.length) {
          stageIssues.push(`task ${task.id} contains duplicate dependencies`);
        }
        if (uniqueDependencies.has(task.id)) stageIssues.push(`task ${task.id} cannot depend on itself`);
        for (const dependencyId of uniqueDependencies) {
          if (!taskIds.has(dependencyId)) {
            stageIssues.push(`task ${task.id} depends on unknown task ${dependencyId}`);
          }
        }
      }
      if (normalizedTasks.length === tasks.length
        && normalizedTasks.every((task) => task.dependsOn.every((id) => taskIds.has(id)))
        && hasDependencyCycle(normalizedTasks)) {
        stageIssues.push('taskGraph dependencies must be acyclic');
      }
    }
  } else if (surfaceId === 'frontend' || surfaceId === 'backend') {
    if (artifact.kind !== 'code_change') stageIssues.push('kind must be code_change');
    if (!nonEmptyStrings(artifact.acceptanceIds)) {
      stageIssues.push('acceptanceIds must contain at least one ID');
    }
    if (!isNonEmptyString(payload.repositoryId)) stageIssues.push('payload.repositoryId is required');
    if (!isNonEmptyString(payload.baselineRevision)) {
      stageIssues.push('payload.baselineRevision is required');
    }
    if (!isSha256(payload.workspaceFingerprintBefore)) {
      stageIssues.push('payload.workspaceFingerprintBefore must be a lowercase SHA-256 hex digest');
    }
    if (!isSha256(payload.workspaceFingerprintAfter)) {
      stageIssues.push('payload.workspaceFingerprintAfter must be a lowercase SHA-256 hex digest');
    }
    const changedFiles = Array.isArray(payload.changedFiles) ? payload.changedFiles : [];
    if (changedFiles.length === 0) {
      stageIssues.push('payload.changedFiles must contain at least one change');
    } else {
      for (const change of changedFiles) {
        if (!isRecord(change)) {
          stageIssues.push('each payload.changedFiles entry must be an object');
          continue;
        }
        if (!isSafeRelativePath(change.path)) {
          stageIssues.push('each changed file requires a safe relative path');
        }
        if (!['added', 'modified', 'deleted'].includes(String(change.operation))) {
          stageIssues.push('each changed file operation must be added, modified, or deleted');
        }
        if (!isNonEmptyString(change.beforeHash)) {
          stageIssues.push('each changed file requires beforeHash');
        }
        if (change.operation !== 'deleted' && !isNonEmptyString(change.afterHash)) {
          stageIssues.push('each non-deleted changed file requires afterHash');
        }
      }
    }
    const diff = isRecord(payload.diff) ? payload.diff : undefined;
    if (!diff || diff.format !== 'unified' || !isSha256(diff.sha256)
      || !isNonEmptyString(diff.storageRef)) {
      stageIssues.push('payload.diff requires format=unified, sha256, and storageRef');
    }
    const commands = Array.isArray(payload.commands) ? payload.commands : [];
    if (commands.length === 0 || commands.some((entry) => {
      if (!isRecord(entry)) return true;
      return !isNonEmptyString(entry.command)
        || !isNonEmptyString(entry.cwd)
        || !isNonEmptyString(entry.startedAt)
        || !isNonEmptyString(entry.completedAt)
        || typeof entry.exitCode !== 'number'
        || !isNonEmptyString(entry.stdoutRef)
        || !isNonEmptyString(entry.stderrRef);
    })) {
      stageIssues.push('payload.commands entries require command, cwd, timestamps, exitCode, stdoutRef, and stderrRef');
    }
    if (!commands.some((entry) => isRecord(entry) && entry.exitCode === 0)) {
      stageIssues.push('commandEvidence must contain at least one successful command');
    }
    const selfTests = Array.isArray(payload.selfTests) ? payload.selfTests : [];
    const acceptanceIds = new Set(artifact.acceptanceIds ?? []);
    const coveredAcceptanceIds = new Set<string>();
    if (selfTests.length === 0 || selfTests.some((entry) => {
      if (!isRecord(entry)) return true;
      if (Array.isArray(entry.acceptanceIds)) {
        for (const acceptanceId of entry.acceptanceIds) {
          if (typeof acceptanceId === 'string') coveredAcceptanceIds.add(acceptanceId);
        }
      }
      return !isNonEmptyString(entry.name)
        || entry.status !== 'passed'
        || !Number.isInteger(entry.commandIndex)
        || Number(entry.commandIndex) < 0
        || Number(entry.commandIndex) >= commands.length
        || !isRecord(commands[Number(entry.commandIndex)])
        || commands[Number(entry.commandIndex)].exitCode !== 0
        || !nonEmptyStrings(entry.acceptanceIds)
        || entry.acceptanceIds.some((id) => !acceptanceIds.has(id));
    })) {
      stageIssues.push('payload.selfTests must map passed command evidence to known acceptance IDs');
    }
    if ([...acceptanceIds].some((id) => !coveredAcceptanceIds.has(id))) {
      stageIssues.push('every Artifact acceptanceId must be covered by a passed selfTest');
    }
    const scope = isRecord(payload.scope) ? payload.scope : undefined;
    if (!scope || !nonEmptyStrings(scope.allowedPaths)
      || scope.allowedPaths.some((path) => !isSafeRelativePath(path))
      || !Array.isArray(scope.outOfScopePaths)) {
      stageIssues.push('payload.scope requires safe allowedPaths and outOfScopePaths');
    }
    const security = isRecord(payload.security) ? payload.security : undefined;
    if (!security || security.secretScanStatus !== 'passed'
      || !Array.isArray(security.sensitivePathsTouched)) {
      stageIssues.push('payload.security requires a passed secret scan and sensitivePathsTouched');
    }
    if (!isNonEmptyString(payload.summary)) stageIssues.push('payload.summary is required');
  } else if (surfaceId === 'testing') {
    if (artifact.kind !== 'verification' && artifact.kind !== 'test_evidence') {
      stageIssues.push('kind must be verification or test_evidence');
    }
    const testEvidence = Array.isArray(payload.testEvidence)
      ? payload.testEvidence as Array<Partial<TestEvidence>>
      : [];
    if (!testEvidence.some((evidence) =>
      typeof evidence.command === 'string' && Boolean(evidence.command.trim())
      && evidence.exitCode === 0 && evidence.passed === true)) {
      stageIssues.push('testEvidence must contain at least one successful test');
    }
  } else if (!artifact.kind.trim()) {
    stageIssues.push('kind must not be empty');
  }
  if (stageIssues.length > 0) {
    return { valid: false, issues: stageIssues, code: 'ARTIFACT_CONTRACT_INVALID' };
  }

  const expectedHash = computeManagedArtifactContentHash(artifact);
  if (artifact.contentHash !== expectedHash) {
    return {
      valid: false,
      issues: ['contentHash does not match the canonical artifact content'],
      code: 'ARTIFACT_CONTRACT_INVALID',
    };
  }
  return { valid: true, issues: [] };
}

export function computeManagedArtifactContentHash(artifact: Record<string, unknown>): string {
  const { contentHash: _contentHash, ...unsignedArtifact } = artifact;
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(unsignedArtifact)), 'utf8')
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}
