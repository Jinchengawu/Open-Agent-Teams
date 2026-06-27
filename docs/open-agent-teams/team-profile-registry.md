# Team Profile Registry

Open-Agent-Teams treats a team as multiple Role Agents coordinated by a framework-level Team Coordination Layer. The framework must not hardcode one application domain such as software development, legal review, sales, or video production.

## Boundary

Team Profile Registry is a framework base capability.

It owns:

- Role Agent definitions
- default routing and fallback Agent IDs
- arbitration Agent selection
- Hermes instance defaults
- lifecycle pipeline template
- communication guide text

Application repositories own domain-specific profiles:

- DEV-Agent-Teams owns PM, frontend, backend, testing, DevOps, and project admin roles.
- Legal-Agent-Teams should own legal discovery, contract review, compliance, risk, and release roles.
- Video-Agent-Teams should own script, storyboard, generation, review, publish, and distribution roles.

## Default Framework Profile

The Open-Agent-Teams default profile is `open-framework`.

Default Role Agents:

- `intent-router`
- `team-orchestrator`
- `workflow-conductor`
- `knowledge-steward`
- `recovery-agent`
- `integration-agent`

The default lifecycle is `open-team-minimum-loop`.

It follows:

```text
discovery -> planning -> execution -> knowledge -> recovery -> integration
```

## Compatibility

Older exports such as `createDevTeamOrchestrator` and `DEV_TEAM_MINIMUM_LOOP_PIPELINE` are retained as compatibility aliases, but they now resolve to the framework-neutral profile. New code should use:

- `OPEN_FRAMEWORK_TEAM_PROFILE`
- `OPEN_TEAM_MINIMUM_LOOP_PIPELINE`
- `createProfileTeamOrchestrator`
- `createOpenTeamOrchestrator`

## Next Step

The next architecture step is to align internal Agent communication with A2A domain semantics. Team Profile provides the stable source of Agent cards, task defaults, arbitration ownership, and runtime adapter selection.
