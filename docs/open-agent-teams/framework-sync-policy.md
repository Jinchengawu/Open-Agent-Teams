# Framework Sync Policy

Open-Agent-Teams is the shared framework and reusable console foundation for downstream products such as DEV-Agent-Teams, Video-Agent-Teams, Legal-Agent-Teams, and future domain teams.

When a downstream product proves a reusable capability, the capability must be evaluated and, when generic, backported here before the downstream phase is considered complete.

## Must Sync

- Team orchestration contracts and provider compatibility guards
- Pipeline execution, control, recovery, and coordination bindings
- Kanban task projection and task-to-workflow/task-to-document links
- Document and knowledge management primitives
- Dashboard/Console product surfaces for framework-level collaboration
- Gateway routes that expose reusable framework capabilities
- Delivery/readiness observability and non-live verification gates
- Shared UI hooks, API proxy routes, and schemas needed by the console

## Should Stay Downstream

- Domain-specific roles, prompts, copy, templates, and workflows
- Product-specific branding and commercial positioning
- Domain-only sample data or generated artifacts
- One-off experiments that have not become reusable abstractions

## Current Console Baseline

The reusable Open-Agent-Teams Console baseline includes:

- Dashboard
- Agents
- Skills
- Chat and meeting/broadcast collaboration
- Sessions
- Workflows
- Kanban
- Pipeline and pipeline instances
- Knowledge center and document/task bindings
- Readiness, snapshots, delivery-gate history, and team-loop observability

Run `bash scripts/check-framework-sync.sh` after every downstream phase that touches shared framework or console capability.
