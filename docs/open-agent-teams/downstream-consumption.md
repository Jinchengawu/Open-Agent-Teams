# Downstream Consumption Guide

Open-Agent-Teams is the framework base. Domain products such as DEV-Agent-Teams,
Video-Agent-Teams, and Legal-Agent-Teams should depend on the framework packages
instead of copying framework code.

## Package Boundary

Framework packages:

| Package | Role | Downstream Usage |
| --- | --- | --- |
| `@open-agent-teams/core` | Team Profile, TeamOrchestrator, Pipeline, Knowledge, Kanban, A2A, delivery primitives | Required by every downstream team product |
| `@open-agent-teams/gateway` | HTTP Gateway for core orchestration and A2A projection routes | Use when the downstream product wants the standard API surface |
| `@open-agent-teams/glue-service` | Runtime integration glue | Use for integration adapters and framework bridge code |
| `@open-agent-teams/dashboard` | Framework console | Usually consumed as source/template until UI package boundaries mature |

Downstream packages should keep domain roles, prompts, workflow templates,
branding, sample data, and production-specific policy in their own repository.

## Supported Consumption Modes

### 1. Workspace Link

Use this during local co-development:

```json
{
  "dependencies": {
    "@open-agent-teams/core": "link:/absolute/path/to/Open-Agent-Teams/packages/core"
  }
}
```

This is the current fastest loop, but it is machine-local and should not be the
default for distributable downstream repositories.

### 2. Packed Tarball

Use this for reproducible private handoff before publishing to a registry:

```bash
pnpm build
pnpm framework:pack
```

This writes package tarballs to `dist-packages/`. A downstream repo can pin:

```json
{
  "dependencies": {
    "@open-agent-teams/core": "file:../Open-Agent-Teams/dist-packages/open-agent-teams-core-0.1.0.tgz"
  }
}
```

### 3. Private Registry

Use this when multiple products need stable versioned dependencies:

```bash
pnpm build
pnpm --filter @open-agent-teams/core publish --access restricted
pnpm --filter @open-agent-teams/gateway publish --access restricted
pnpm --filter @open-agent-teams/glue-service publish --access restricted
```

Version policy:

- Patch: bug fix, no contract change.
- Minor: additive framework feature.
- Major: breaking API or persisted data contract change.

## Downstream Product Shape

A downstream team product should normally provide:

- domain `TeamProfile`
- domain lifecycle Pipeline templates
- domain Gateway extension routes only when needed
- domain Dashboard copy/branding/data seeds
- deployment and artifact retention policy

It should not fork:

- generic A2A types/transports
- generic Pipeline control/recovery
- generic Knowledge/Document/Kanban managers
- generic delivery-gate semantics

## Required Validation Before Adoption

Before a downstream product updates its Open-Agent-Teams dependency:

```bash
pnpm build
RUN_PIPELINE_CONTROL_SMOKE=1 RUN_PIPELINE_RECOVERY_SMOKE=1 zsh scripts/e2e-delivery-gate.sh
```

The downstream repository must also run its own product delivery gate after the
dependency update. A framework update is not considered adopted until both
gates pass.
