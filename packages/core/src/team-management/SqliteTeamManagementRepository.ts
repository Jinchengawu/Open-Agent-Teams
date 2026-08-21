import type Database from 'better-sqlite3';
import type { Project, Team, TeamSelection } from './types.js';

interface TeamRow {
  id: string;
  organization_id: string;
  name: string;
  status: Team['status'];
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface ProjectRow {
  id: string;
  organization_id: string;
  team_id: string;
  name: string;
  description: string;
  status: Project['status'];
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface SelectionRow {
  organization_id: string;
  user_id: string;
  team_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export class SqliteTeamManagementRepository {
  constructor(private readonly database: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS business_teams (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        UNIQUE (organization_id, normalized_name)
      );

      CREATE INDEX IF NOT EXISTS idx_business_teams_organization
        ON business_teams (organization_id, status, created_at);

      CREATE TABLE IF NOT EXISTS business_projects (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        FOREIGN KEY (team_id) REFERENCES business_teams(id)
      );

      CREATE INDEX IF NOT EXISTS idx_business_projects_team
        ON business_projects (organization_id, team_id, status, created_at);

      CREATE TABLE IF NOT EXISTS business_team_selections (
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, user_id),
        FOREIGN KEY (team_id) REFERENCES business_teams(id)
      );

      CREATE TABLE IF NOT EXISTS business_team_audit_logs (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  insertTeam(team: Team, actorUserId: string, auditId: string): Team {
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO business_teams (
          id, organization_id, name, normalized_name, status, version,
          created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        team.id,
        team.organizationId,
        team.name,
        team.name.toLocaleLowerCase(),
        team.status,
        team.version,
        team.createdAt,
        team.updatedAt,
        team.archivedAt,
      );
      this.insertAudit(auditId, team.organizationId, actorUserId, 'team.created', 'team', team.id, team.createdAt);
      return team;
    });
    return transaction();
  }

  findTeam(organizationId: string, teamId: string, includeArchived = false): Team | null {
    const archivedClause = includeArchived ? '' : "AND status != 'archived'";
    const row = this.database.prepare(`
      SELECT * FROM business_teams
      WHERE organization_id = ? AND id = ? ${archivedClause}
    `).get(organizationId, teamId) as TeamRow | undefined;
    return row ? toTeam(row) : null;
  }

  listTeams(organizationId: string, includeArchived = false): Team[] {
    const archivedClause = includeArchived ? '' : "AND status != 'archived'";
    const rows = this.database.prepare(`
      SELECT * FROM business_teams
      WHERE organization_id = ? ${archivedClause}
      ORDER BY created_at ASC, id ASC
    `).all(organizationId) as TeamRow[];
    return rows.map(toTeam);
  }

  renameTeam(input: {
    organizationId: string;
    teamId: string;
    name: string;
    expectedVersion: number;
    updatedAt: string;
    actorUserId: string;
    auditId: string;
  }): Team | null {
    const transaction = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE business_teams
        SET name = ?, normalized_name = ?, version = version + 1, updated_at = ?
        WHERE organization_id = ? AND id = ? AND status = 'active' AND version = ?
      `).run(
        input.name,
        input.name.toLocaleLowerCase(),
        input.updatedAt,
        input.organizationId,
        input.teamId,
        input.expectedVersion,
      );
      if (result.changes !== 1) return null;
      this.insertAudit(
        input.auditId,
        input.organizationId,
        input.actorUserId,
        'team.renamed',
        'team',
        input.teamId,
        input.updatedAt,
        { expectedVersion: input.expectedVersion },
      );
      return this.findTeam(input.organizationId, input.teamId);
    });
    return transaction();
  }

  archiveTeam(input: {
    organizationId: string;
    teamId: string;
    expectedVersion: number;
    archivedAt: string;
    actorUserId: string;
    auditId: string;
  }): Team | null {
    const transaction = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE business_teams
        SET status = 'archived', archived_at = ?, updated_at = ?, version = version + 1
        WHERE organization_id = ? AND id = ? AND status = 'active' AND version = ?
      `).run(
        input.archivedAt,
        input.archivedAt,
        input.organizationId,
        input.teamId,
        input.expectedVersion,
      );
      if (result.changes !== 1) return null;
      this.database.prepare(`
        DELETE FROM business_team_selections
        WHERE organization_id = ? AND team_id = ?
      `).run(input.organizationId, input.teamId);
      this.insertAudit(
        input.auditId,
        input.organizationId,
        input.actorUserId,
        'team.archived',
        'team',
        input.teamId,
        input.archivedAt,
        { expectedVersion: input.expectedVersion },
      );
      return this.findTeam(input.organizationId, input.teamId, true);
    });
    return transaction();
  }

  insertProject(project: Project, actorUserId: string, auditId: string): Project {
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO business_projects (
          id, organization_id, team_id, name, description, status, version,
          created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        project.id,
        project.organizationId,
        project.teamId,
        project.name,
        project.description,
        project.status,
        project.version,
        project.createdAt,
        project.updatedAt,
        project.archivedAt,
      );
      this.insertAudit(auditId, project.organizationId, actorUserId, 'project.created', 'project', project.id, project.createdAt);
      return project;
    });
    return transaction();
  }

  listProjects(organizationId: string, teamId: string): Project[] {
    const rows = this.database.prepare(`
      SELECT * FROM business_projects
      WHERE organization_id = ? AND team_id = ? AND status != 'archived'
      ORDER BY created_at ASC, id ASC
    `).all(organizationId, teamId) as ProjectRow[];
    return rows.map(toProject);
  }

  getSelection(organizationId: string, userId: string): TeamSelection | null {
    const row = this.database.prepare(`
      SELECT * FROM business_team_selections
      WHERE organization_id = ? AND user_id = ?
    `).get(organizationId, userId) as SelectionRow | undefined;
    return row ? toSelection(row) : null;
  }

  selectTeam(input: {
    organizationId: string;
    userId: string;
    teamId: string;
    expectedVersion: number;
    timestamp: string;
    auditId: string;
  }): TeamSelection | null {
    const transaction = this.database.transaction(() => {
      const current = this.getSelection(input.organizationId, input.userId);
      if (!current) {
        if (input.expectedVersion !== 0) return null;
        this.database.prepare(`
          INSERT INTO business_team_selections (
            organization_id, user_id, team_id, version, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?)
        `).run(
          input.organizationId,
          input.userId,
          input.teamId,
          input.timestamp,
          input.timestamp,
        );
      } else {
        if (current.version !== input.expectedVersion) return null;
        this.database.prepare(`
          UPDATE business_team_selections
          SET team_id = ?, version = version + 1, updated_at = ?
          WHERE organization_id = ? AND user_id = ? AND version = ?
        `).run(
          input.teamId,
          input.timestamp,
          input.organizationId,
          input.userId,
          input.expectedVersion,
        );
      }
      this.insertAudit(
        input.auditId,
        input.organizationId,
        input.userId,
        'team.selected',
        'team',
        input.teamId,
        input.timestamp,
        { expectedVersion: input.expectedVersion },
      );
      return this.getSelection(input.organizationId, input.userId);
    });
    return transaction();
  }

  private insertAudit(
    id: string,
    organizationId: string,
    actorUserId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    createdAt: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.database.prepare(`
      INSERT INTO business_team_audit_logs (
        id, organization_id, actor_user_id, action, resource_type,
        resource_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      organizationId,
      actorUserId,
      action,
      resourceType,
      resourceId,
      metadata ? JSON.stringify(metadata) : null,
      createdAt,
    );
  }
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    teamId: row.team_id,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toSelection(row: SelectionRow): TeamSelection {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    teamId: row.team_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
