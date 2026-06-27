export const BUILTIN_TEMPLATES = [
    {
        id: 'team-lifecycle',
        name: 'Team Lifecycle',
        description: 'Request → Discovery → Planning → Execution → Knowledge → Recovery → Integration',
        steps: [
            {
                agentId: 'intent-router',
                order: 0,
                inputTemplate: '{{userRequest}}',
                description: 'Clarify intent and acceptance criteria',
                requiresPreviousOutput: false,
            },
            {
                agentId: 'team-orchestrator',
                order: 1,
                inputTemplate: 'Discovery:\n{{step0.output}}\n\nCreate the team coordination plan, task owners, dependencies, and expected artifacts.',
                description: 'Create coordination plan',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'workflow-conductor',
                order: 2,
                inputTemplate: 'Coordination Plan:\n{{step1.output}}\n\nExecute the workflow surfaces and produce handoff artifacts.',
                description: 'Execute workflow surfaces',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'knowledge-steward',
                order: 3,
                inputTemplate: 'Workflow Artifacts:\n{{step2.output}}\n\nBind documents, tasks, agents, and artifacts into a traceability report.',
                description: 'Bind artifacts to organizational memory',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'recovery-agent',
                order: 4,
                inputTemplate: 'Traceability Report:\n{{step3.output}}\n\nReview quality, risk, failure states, and recovery actions.',
                description: 'Review quality and recovery needs',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'integration-agent',
                order: 5,
                inputTemplate: 'Quality Review:\n{{step4.output}}\n\nPrepare final handoff, experience summary, and follow-up tasks.',
                description: 'Capture handoff and experience',
                requiresPreviousOutput: true,
            },
        ],
    },
    {
        id: 'recovery-loop',
        name: 'Recovery Loop',
        description: 'Incident or blocker → diagnosis → recovery plan → integration follow-up',
        steps: [
            {
                agentId: 'intent-router',
                order: 0,
                inputTemplate: '{{userRequest}}',
                description: 'Triage and classify the issue',
                requiresPreviousOutput: false,
            },
            {
                agentId: 'recovery-agent',
                order: 1,
                inputTemplate: 'Issue Triage:\n{{step0.output}}\n\nDiagnose the failure, classify risk, and propose recovery actions.',
                description: 'Diagnose and plan recovery',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'team-orchestrator',
                order: 2,
                inputTemplate: 'Recovery Plan:\n{{step1.output}}\n\nCreate tasks, owners, and verification gates for recovery.',
                description: 'Create recovery tasks and gates',
                requiresPreviousOutput: true,
            },
            {
                agentId: 'integration-agent',
                order: 3,
                inputTemplate: 'Recovery Tasks:\n{{step2.output}}\n\nCapture final handoff, residual risks, and reusable experience.',
                description: 'Capture final recovery handoff',
                requiresPreviousOutput: true,
            },
        ],
    },
    {
        id: 'quick-coordination',
        name: 'Quick Coordination',
        description: 'Single-agent team coordination task',
        steps: [
            {
                agentId: 'team-orchestrator',
                order: 0,
                inputTemplate: '{{userRequest}}',
                description: 'Produce a concise coordination answer',
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