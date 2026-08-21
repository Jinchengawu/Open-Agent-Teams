import { randomUUID } from 'node:crypto';
import type { SqliteTeamManagementRepository } from './SqliteTeamManagementRepository.js';
import type { Project, Team, TeamArchiveGuard, TeamManagementActor, TeamSelection } from './types.js';

export type TeamManagementErrorCode =
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'TEAM_NAME_CONFLICT'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_VERSION_CONFLICT'
  | 'TEAM_HAS_RUNNING_TASKS'
  | 'SELECTION_VERSION_CONFLICT';

export class TeamManagementError extends Error {
  constructor(
    public readonly code: TeamManagementErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TeamManagementError';
  }
}

interface TeamManagementServiceOptions {
  repository: SqliteTeamManagementRepository;
  now?: () => string;
  createId?: (prefix: 'team' | 'project' | 'audit') => string;
  archiveGuard?: TeamArchiveGuard;
}

export class TeamManagementService {
  private readonly now: () => string;
  private readonly createId: (prefix: 'team' | 'project' | 'audit') => string;
  private readonly archiveGuard: TeamArchiveGuard;

  constructor(private readonly options: TeamManagementServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.archiveGuard = options.archiveGuard ?? { hasRunningTasks: () => false };
  }

  createTeam(actor: TeamManagementActor, input: { name: string }): Team {
    this.requireManage(actor);
    const name = requireName(input.name, 'Team 名称');
    const timestamp = this.now();
    const team: Team = {
      id: this.createId('team'),
      organizationId: actor.organizationId,
      name,
      status: 'active',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    };
    try {
      return this.options.repository.insertTeam(team, actor.userId, this.createId('audit'));
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new TeamManagementError('TEAM_NAME_CONFLICT', '当前组织中已存在同名 Team', 409);
      }
      throw error;
    }
  }

  getTeam(actor: TeamManagementActor, teamId: string, includeArchived = false): Team {
    const team = this.options.repository.findTeam(actor.organizationId, teamId, includeArchived);
    if (!team) throw new TeamManagementError('TEAM_NOT_FOUND', 'Team 不存在', 404);
    return team;
  }

  listTeams(actor: TeamManagementActor, includeArchived = false): Team[] {
    return this.options.repository.listTeams(actor.organizationId, includeArchived);
  }

  renameTeam(
    actor: TeamManagementActor,
    teamId: string,
    input: { name: string; expectedVersion: number },
  ): Team {
    this.requireManage(actor);
    const name = requireName(input.name, 'Team 名称');
    try {
      const updated = this.options.repository.renameTeam({
        organizationId: actor.organizationId,
        teamId,
        name,
        expectedVersion: input.expectedVersion,
        updatedAt: this.now(),
        actorUserId: actor.userId,
        auditId: this.createId('audit'),
      });
      if (updated) return updated;
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new TeamManagementError('TEAM_NAME_CONFLICT', '当前组织中已存在同名 Team', 409);
      }
      throw error;
    }
    const current = this.options.repository.findTeam(actor.organizationId, teamId);
    if (!current) throw new TeamManagementError('TEAM_NOT_FOUND', 'Team 不存在', 404);
    throw new TeamManagementError('TEAM_VERSION_CONFLICT', 'Team 已被其他操作更新，请刷新后重试', 409);
  }

  archiveTeam(
    actor: TeamManagementActor,
    teamId: string,
    input: { expectedVersion: number },
  ): Team {
    this.requireManage(actor);
    const current = this.getTeam(actor, teamId);
    if (this.archiveGuard.hasRunningTasks({
      organizationId: actor.organizationId,
      teamId,
    })) {
      throw new TeamManagementError(
        'TEAM_HAS_RUNNING_TASKS',
        'Team 存在运行中的任务，停止任务后才能归档',
        409,
      );
    }
    const archivedAt = this.now();
    const archived = this.options.repository.archiveTeam({
      organizationId: actor.organizationId,
      teamId,
      expectedVersion: input.expectedVersion,
      archivedAt,
      actorUserId: actor.userId,
      auditId: this.createId('audit'),
    });
    if (archived) return archived;
    const latest = this.options.repository.findTeam(actor.organizationId, teamId, true);
    if (!latest || current.status === 'archived') {
      throw new TeamManagementError('TEAM_NOT_FOUND', 'Team 不存在', 404);
    }
    throw new TeamManagementError('TEAM_VERSION_CONFLICT', 'Team 已被其他操作更新，请刷新后重试', 409);
  }

  createProject(
    actor: TeamManagementActor,
    input: { teamId: string; name: string; description?: string },
  ): Project {
    this.requireManage(actor);
    const team = this.getTeam(actor, input.teamId);
    const timestamp = this.now();
    const project: Project = {
      id: this.createId('project'),
      organizationId: actor.organizationId,
      teamId: team.id,
      name: requireName(input.name, 'Project 名称'),
      description: input.description?.trim() ?? '',
      status: 'active',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    };
    return this.options.repository.insertProject(project, actor.userId, this.createId('audit'));
  }

  listProjects(actor: TeamManagementActor, teamId: string): Project[] {
    this.getTeam(actor, teamId);
    return this.options.repository.listProjects(actor.organizationId, teamId);
  }

  selectTeam(
    actor: TeamManagementActor,
    teamId: string,
    input: { expectedVersion: number },
  ): TeamSelection {
    this.getTeam(actor, teamId);
    const selection = this.options.repository.selectTeam({
      organizationId: actor.organizationId,
      userId: actor.userId,
      teamId,
      expectedVersion: input.expectedVersion,
      timestamp: this.now(),
      auditId: this.createId('audit'),
    });
    if (!selection) {
      throw new TeamManagementError(
        'SELECTION_VERSION_CONFLICT',
        'Team 选择已在其他位置更新，请刷新后重试',
        409,
      );
    }
    return selection;
  }

  getSelection(actor: TeamManagementActor): TeamSelection | null {
    return this.options.repository.getSelection(actor.organizationId, actor.userId);
  }

  getSelectedTeam(actor: TeamManagementActor): Team | null {
    const selection = this.getSelection(actor);
    if (!selection) return null;
    return this.options.repository.findTeam(actor.organizationId, selection.teamId);
  }

  private requireManage(actor: TeamManagementActor): void {
    if (actor.permissions.includes('*') || actor.permissions.includes('team:manage')) return;
    throw new TeamManagementError('FORBIDDEN', '只有 Organization Owner/Admin 可以管理 Team', 403);
  }
}

function requireName(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TeamManagementError('INVALID_INPUT', `${label}不能为空`, 400);
  if (normalized.length > 80) throw new TeamManagementError('INVALID_INPUT', `${label}不能超过 80 个字符`, 400);
  return normalized;
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
