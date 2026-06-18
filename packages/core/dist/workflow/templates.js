export const BUILTIN_TEMPLATES = [
    {
        id: 'full-stack-feature',
        name: 'Full Stack Feature',
        description: 'End-to-end feature: PM requirements → Backend → Frontend → Testing → DevOps',
        steps: [
            {
                agentId: 'dev-pm',
                order: 0,
                inputTemplate: '{{userRequest}}',
                description: 'Analyze requirements and produce PRD',
                requiresPreviousOutput: false,
            },
            {
                agentId: 'dev-backend',
                order: 1,
                inputTemplate: 'PRD Requirements:\n{{step0.output}}\n\nImplement the backend API and database for this feature.',
                description: 'Implement backend API and database',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'dev-frontend',
                order: 2,
                inputTemplate: 'Backend Implementation:\n{{step1.output}}\n\nBuild the frontend components for this feature.',
                description: 'Build frontend components',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'dev-testing',
                order: 3,
                inputTemplate: 'Feature Spec:\n{{step0.output}}\n\nBackend:\n{{step1.output}}\n\nFrontend:\n{{step2.output}}\n\nWrite comprehensive tests for this feature.',
                description: 'Write tests for the implementation',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'dev-devops',
                order: 4,
                inputTemplate: 'Implementation Summary:\nBackend: {{step1.output}}\nTests: {{step3.output}}\n\nCreate Docker deployment configuration for this feature.',
                description: 'Dockerize and prepare deployment',
                requiresPreviousOutput: true,
            },
        ],
    },
    {
        id: 'bug-fix',
        name: 'Bug Fix Pipeline',
        description: 'Report → Fix → Test → Deploy a bug fix',
        steps: [
            {
                agentId: 'dev-pm',
                order: 0,
                inputTemplate: '{{userRequest}}',
                description: 'Triage and analyze the bug',
                requiresPreviousOutput: false,
            },
            {
                agentId: 'dev-backend',
                order: 1,
                inputTemplate: 'Bug Analysis:\n{{step0.output}}\n\nFix this bug.',
                description: 'Implement the fix',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'dev-testing',
                order: 2,
                inputTemplate: 'Fix:\n{{step1.output}}\n\nVerify the fix and write regression tests.',
                description: 'Verify the fix',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'dev-devops',
                order: 3,
                inputTemplate: 'Verified Fix:\n{{step2.output}}\n\nDeploy the fix.',
                description: 'Deploy the fix',
                requiresPreviousOutput: true,
            },
        ],
    },
    {
        id: 'quick-backend',
        name: 'Quick Backend Task',
        description: 'Single-agent backend development',
        steps: [
            {
                agentId: 'dev-backend',
                order: 0,
                inputTemplate: '{{userRequest}}',
                description: 'Implement backend feature',
                requiresPreviousOutput: false,
            },
        ],
    },
];
const WORKFLOW_SCHEMA = `
CREATE TABLE IF NOT EXISTS workflows (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  template      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  current_step  INTEGER NOT NULL DEFAULT 0,
  context       TEXT DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL,
  step_order    INTEGER NOT NULL,
  input         TEXT NOT NULL DEFAULT '',
  output        TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',
  started_at    TEXT,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_order ON workflow_steps(workflow_id, step_order);
`;
export { WORKFLOW_SCHEMA };
//# sourceMappingURL=templates.js.map