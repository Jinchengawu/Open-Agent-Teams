export type TeamStatus = 'active' | 'archived';
export type ProjectStatus = 'active' | 'archived';

export interface TeamManagementActor {
  organizationId: string;
  userId: string;
  permissions: string[];
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  status: TeamStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Project {
  id: string;
  organizationId: string;
  teamId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TeamSelection {
  organizationId: string;
  userId: string;
  teamId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamArchiveGuard {
  hasRunningTasks(scope: { organizationId: string; teamId: string }): boolean;
}
