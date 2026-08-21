import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SandboxAttestation } from './ExecutionSandbox.js';

export interface StagedGitWorkspaceSpec {
  taskId: string;
  attemptId: string;
  repositoryRoot: string;
  baselineRevision: string;
}

export interface StagedGitWorkspace {
  id: string;
  root: string;
  sourceRepositoryRoot: string;
  baselineRevision: string;
  attestation: SandboxAttestation;
}

/**
 * Creates a detached temporary worktree so Agent execution cannot mutate the
 * user's working tree before validation. This is application isolation, not an
 * OS security boundary, and its attestation states that limitation explicitly.
 */
export class StagedGitWorkspaceManager {
  prepare(spec: StagedGitWorkspaceSpec): StagedGitWorkspace {
    if (!spec.taskId.trim() || !spec.attemptId.trim()) throw new Error('taskId and attemptId are required');
    const repositoryRoot = realpathSync(resolve(spec.repositoryRoot));
    const repositoryTop = realpathSync(git(repositoryRoot, ['rev-parse', '--show-toplevel']).trim());
    if (repositoryRoot !== repositoryTop) throw new Error('repositoryRoot must be the Git repository root');
    const baselineRevision = git(repositoryRoot, [
      'rev-parse', '--verify', '--end-of-options', `${spec.baselineRevision}^{commit}`,
    ]).trim();
    const tempParent = mkdtempSync(join(tmpdir(), 'dev-agent-staging-'));
    const root = join(tempParent, 'worktree');
    try {
      git(repositoryRoot, ['worktree', 'add', '--detach', '--no-checkout', root, baselineRevision]);
      git(root, ['checkout', '--detach', baselineRevision]);
    } catch (error) {
      rmSync(tempParent, { recursive: true, force: true });
      throw error;
    }
    const id = `staged-${randomUUID()}`;
    return {
      id,
      root,
      sourceRepositoryRoot: repositoryRoot,
      baselineRevision,
      attestation: {
        isolationLevel: 'local-policy',
        adapter: 'staged-git-worktree/v1',
        taskId: spec.taskId,
        attemptId: spec.attemptId,
        preparedAt: new Date().toISOString(),
        sourceWorkspaceMutated: false,
        limitations: [
          'No OS, network, process, resource, or credential isolation is provided.',
          'Validated changes require a separate explicit export step.',
        ],
      },
    };
  }

  createPatch(workspace: StagedGitWorkspace): string {
    this.assertManagedWorkspace(workspace);
    const tracked = git(workspace.root, ['diff', '--binary', '--full-index', '--no-ext-diff', workspace.baselineRevision, '--']);
    const untrackedPaths = this.untrackedPaths(workspace);
    const untracked = untrackedPaths.map((path) => gitAccepted(
      workspace.root,
      ['diff', '--no-index', '--binary', '--full-index', '--', '/dev/null', path],
      [0, 1],
    )).join('');
    return `${tracked}${untracked}`;
  }

  applyPatch(workspace: StagedGitWorkspace, patch: string): void {
    this.assertManagedWorkspace(workspace);
    if (!patch.trim()) throw new Error('Staged Git patch is empty');
    const result = spawnSync('git', ['apply', '--binary', '--whitespace=nowarn', '-'], {
      cwd: workspace.root,
      encoding: 'utf8',
      input: patch,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Staged Git patch apply failed: ${result.error?.message || result.stderr || result.status}`);
    }
  }

  changedPaths(workspace: StagedGitWorkspace): string[] {
    this.assertManagedWorkspace(workspace);
    const tracked = git(workspace.root, [
      'diff', '--name-only', '-z', '--find-renames', workspace.baselineRevision, '--',
    ]).split('\0').filter(Boolean);
    return [...new Set([...tracked, ...this.untrackedPaths(workspace)])].sort();
  }

  /** Server-side patch integrity self-test; never executes code from the patch. */
  verifyPatchIntegrity(workspace: StagedGitWorkspace): void {
    this.assertManagedWorkspace(workspace);
    git(workspace.root, ['diff', '--check', workspace.baselineRevision, '--']);
  }

  destroy(workspace: StagedGitWorkspace): SandboxAttestation {
    this.assertManagedWorkspace(workspace);
    const tempParent = resolve(workspace.root, '..');
    git(workspace.sourceRepositoryRoot, ['worktree', 'remove', '--force', workspace.root]);
    rmSync(tempParent, { recursive: true, force: true });
    return {
      ...workspace.attestation,
      destroyedAt: new Date().toISOString(),
      cleanupReceipt: `git-worktree-removed:${workspace.id}`,
      sourceWorkspaceMutated: false,
    };
  }

  private assertManagedWorkspace(workspace: StagedGitWorkspace): void {
    const tempRoot = realpathSync(tmpdir());
    const resolvedRoot = realpathSync(resolve(workspace.root));
    if (!resolvedRoot.startsWith(`${tempRoot}/dev-agent-staging-`) || !resolvedRoot.endsWith('/worktree')) {
      throw new Error('Refusing to manage a workspace outside the staging temp boundary');
    }
  }

  private untrackedPaths(workspace: StagedGitWorkspace): string[] {
    return git(workspace.root, ['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0').filter(Boolean);
  }
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Staged Git workspace command failed: ${detail}`);
  }
}

function gitAccepted(cwd: string, args: string[], statuses: number[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const status = result.status ?? -1;
  if (result.error || !statuses.includes(status)) {
    throw new Error(`Staged Git workspace command failed: ${result.error?.message || result.stderr || status}`);
  }
  return result.stdout || '';
}
