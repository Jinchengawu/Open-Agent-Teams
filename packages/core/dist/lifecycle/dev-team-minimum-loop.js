/**
 * Minimum development lifecycle pipeline.
 *
 * This is the default product spine for Agent Teams:
 * Meeting -> Document -> Kanban -> Workflow -> Artifact -> Experience.
 */
export const DEV_TEAM_MINIMUM_LOOP_PIPELINE = {
    id: 'dev-team-minimum-loop',
    name: 'Agent Team Minimum Lifecycle',
    version: '0.1.0',
    context: {
        description: 'A narrow software delivery loop that turns one user request into documents, tasks, implementation guidance, verification, release notes, and experience capture.',
        cache: {
            compression: true,
            retention: '14d',
            maxContextLength: 12000,
        },
    },
    surfaces: [
        {
            id: 'discovery',
            name: 'Meeting and PRD Discovery',
            agent: 'dev-pm',
            output: {
                artifacts: ['meeting_summary', 'prd', 'acceptance_criteria'],
                format: 'markdown',
                description: 'Requirement clarification and PRD-style document.',
            },
            workflow: {
                goal: 'Lead the requirement discovery surface for the user request. Clarify goals, users, constraints, risks, acceptance criteria, and produce a PRD-style markdown document. If document tools are available, create or update a document so the result can be reused by downstream surfaces.',
                steps: [
                    'Summarize the raw user request and unknowns.',
                    'Identify target users, scope, non-goals, risks, and acceptance criteria.',
                    'Produce a concise PRD-style document with clear sections.',
                    'List the downstream work items that should become Kanban tasks.',
                ],
                context: 'This surface represents meeting mode as a durable output: the expected result is a decision-bearing document, not a transcript.',
            },
            gate: { type: 'auto' },
        },
        {
            id: 'planning',
            name: 'Kanban Planning',
            agent: 'project-admin',
            input: {
                required: ['prd'],
                from: 'discovery',
            },
            output: {
                artifacts: ['task_plan', 'kanban_tasks', 'workflow_bindings'],
                format: 'markdown',
                description: 'Kanban-ready plan with owners, states, and workflow intent.',
            },
            workflow: {
                goal: 'Convert the PRD into a Kanban-ready execution plan. Split the work into small tasks, assign each task to the best Role Agent, define status/progress expectations, and bind each task to the document and lifecycle stage. If Kanban tools are available, create the initial tasks.',
                steps: [
                    'Extract deliverables and acceptance criteria from the PRD.',
                    'Create tasks for frontend, backend, testing, release, and documentation work.',
                    'Assign tasks to Role Agents and identify dependencies.',
                    'Produce a markdown task plan that can be displayed on the Kanban board.',
                ],
                context: 'Kanban is the team state projection. It should connect documents, tasks, owners, workflow stages, blockers, and artifacts.',
            },
            gate: { type: 'auto' },
        },
        {
            id: 'frontend',
            name: 'Frontend Implementation Surface',
            agent: 'dev-frontend',
            input: {
                required: ['output'],
                from: 'planning',
            },
            output: {
                artifacts: ['frontend_plan', 'frontend_code', 'ui_notes'],
                format: 'markdown',
                description: 'Frontend implementation plan or code artifact.',
            },
            workflow: {
                goal: 'Execute the frontend portion of the task plan. Produce implementation notes, code where appropriate, affected files, test expectations, and any blockers.',
                steps: [
                    'Read the PRD and task plan from upstream artifacts.',
                    'Identify UI states, components, data needs, and interaction flows.',
                    'Produce code or a concrete implementation plan.',
                    'List frontend verification steps and remaining risks.',
                ],
            },
        },
        {
            id: 'backend',
            name: 'Backend Implementation Surface',
            agent: 'dev-backend',
            input: {
                required: ['output'],
                from: 'planning',
            },
            output: {
                artifacts: ['backend_plan', 'api_contract', 'backend_code'],
                format: 'markdown',
                description: 'Backend/API/data implementation plan or code artifact.',
            },
            workflow: {
                goal: 'Execute the backend portion of the task plan. Produce API/data design, implementation notes, code where appropriate, test expectations, and any blockers.',
                steps: [
                    'Read the PRD and task plan from upstream artifacts.',
                    'Identify API contracts, data model changes, auth/security concerns, and integration points.',
                    'Produce code or a concrete implementation plan.',
                    'List backend verification steps and remaining risks.',
                ],
            },
        },
        {
            id: 'testing',
            name: 'Testing and Quality Surface',
            agent: 'dev-testing',
            input: {
                required: ['output'],
            },
            output: {
                artifacts: ['test_plan', 'test_report', 'quality_risks'],
                format: 'markdown',
                description: 'Verification plan, test evidence, and quality risks.',
            },
            workflow: {
                goal: 'Verify the implementation artifacts from frontend and backend surfaces. Produce a test plan, recommended commands, expected evidence, and a release risk assessment.',
                steps: [
                    'Review frontend and backend artifacts.',
                    'Map acceptance criteria to tests.',
                    'Define unit, integration, and E2E checks.',
                    'Produce a quality report with pass/fail/blocked status.',
                ],
            },
            gate: {
                type: 'check',
                condition: 'critical acceptance criteria are covered or explicitly marked blocked',
            },
        },
        {
            id: 'release',
            name: 'Release Readiness Surface',
            agent: 'dev-devops',
            input: {
                required: ['output'],
                from: 'testing',
            },
            output: {
                artifacts: ['deployment_plan', 'release_notes', 'operations_risks'],
                format: 'markdown',
                description: 'Deployment or release-readiness notes.',
            },
            workflow: {
                goal: 'Prepare release readiness for the verified work. Produce deployment steps, rollback notes, environment assumptions, monitoring checks, and release notes.',
                steps: [
                    'Read the quality report and implementation artifacts.',
                    'Define deployment and rollback steps.',
                    'List environment variables, migrations, or operational concerns.',
                    'Produce release notes and monitoring checks.',
                ],
            },
        },
        {
            id: 'retrospective',
            name: 'Experience Capture Surface',
            agent: 'project-admin',
            input: {
                required: ['output'],
                from: 'release',
            },
            output: {
                artifacts: ['retrospective', 'experience_notes', 'follow_up_tasks'],
                format: 'markdown',
                description: 'Experience capture and follow-up work.',
            },
            workflow: {
                goal: 'Capture what the team learned from this lifecycle run. Summarize decisions, reusable patterns, unresolved risks, follow-up tasks, and knowledge that should be saved for future work.',
                steps: [
                    'Summarize the lifecycle run and final state.',
                    'Extract reusable experience and decision records.',
                    'Identify follow-up tasks or blockers.',
                    'Write a retrospective-style experience document.',
                ],
                context: 'Experience is the durable learning extracted from work. It should be saved as a document or knowledge artifact.',
            },
            gate: { type: 'auto' },
        },
    ],
    edges: [
        {
            from: 'discovery',
            to: 'planning',
            description: 'The meeting/PRD document becomes the planning input.',
        },
        {
            from: 'planning',
            to: ['frontend', 'backend'],
            description: 'Kanban planning fans out into parallel implementation surfaces.',
        },
        {
            from: 'frontend',
            to: 'testing',
            description: 'Frontend artifacts feed verification.',
        },
        {
            from: 'backend',
            to: 'testing',
            description: 'Backend artifacts feed verification.',
        },
        {
            from: 'testing',
            to: 'release',
            description: 'Quality evidence gates release readiness.',
        },
        {
            from: 'release',
            to: 'retrospective',
            description: 'Release notes and operational risks feed experience capture.',
        },
    ],
};
//# sourceMappingURL=dev-team-minimum-loop.js.map