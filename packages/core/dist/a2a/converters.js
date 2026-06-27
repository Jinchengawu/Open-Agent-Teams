export function createA2ATextPart(text, metadata) {
    return { kind: 'text', text, metadata };
}
export function createA2ADataPart(data, metadata) {
    return { kind: 'data', data, metadata };
}
export function createA2AMessage(input) {
    return {
        messageId: input.messageId || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        role: input.role,
        contextId: input.contextId,
        taskId: input.taskId,
        parts: input.parts || [createA2ATextPart(input.text || '')],
        metadata: input.metadata,
    };
}
export function agentMessageToA2AMessage(message) {
    return {
        messageId: message.id,
        contextId: message.metadata.sessionId,
        role: 'agent',
        parts: [createA2ATextPart(message.content)],
        metadata: {
            from: message.from,
            to: message.to,
            type: message.type,
            timestamp: message.metadata.timestamp,
            correlationId: message.metadata.correlationId,
            round: message.metadata.round,
        },
    };
}
export function a2aMessageToAgentMessage(message, fallback) {
    return {
        from: String(message.metadata?.from || fallback.from),
        to: String(message.metadata?.to || fallback.to),
        type: fallback.type || inferAgentMessageType(message),
        content: partsToText(message.parts),
        metadata: {
            sessionId: message.contextId || 'default',
            correlationId: String(message.metadata?.correlationId || message.messageId),
            timestamp: Date.now(),
        },
    };
}
export function teamProfileAgentToA2AAgentCard(profile, agent) {
    const skills = [
        ...agent.expertise.map((item) => ({
            id: slugify(item),
            name: item,
            tags: agent.tags,
        })),
        ...agent.typicalTasks.map((item) => ({
            id: slugify(item),
            name: item,
            description: `Typical task for ${agent.name}`,
            tags: ['example'],
        })),
    ];
    return {
        protocolVersion: '0.3.0',
        name: agent.name,
        description: `${agent.role}. Team profile: ${profile.name}.`,
        version: '0.1.0',
        capabilities: {
            streaming: false,
            pushNotifications: false,
            stateTransitionHistory: true,
            pauseResume: true,
        },
        defaultInputModes: ['text/plain', 'application/json'],
        defaultOutputModes: ['text/plain', 'text/markdown', 'application/json'],
        skills,
        preferredTransport: 'HTTP+JSON',
        metadata: {
            profileId: profile.id,
            agentId: agent.id,
            role: agent.role,
            tags: agent.tags || [],
            hermesPort: agent.hermesPort,
        },
    };
}
export function teamProfileToA2AAgentCards(profile) {
    return profile.agents.map((agent) => teamProfileAgentToA2AAgentCard(profile, agent));
}
export function pipelineInstanceToA2ATask(instance) {
    const contextId = instance.workflowStateId || instance.id;
    const artifacts = Array.from(instance.surfaceResults.values())
        .filter((result) => result.artifacts)
        .map((result) => surfaceResultToA2AArtifact(result));
    return {
        id: instance.id,
        contextId,
        status: {
            state: pipelineStatusToA2AState(instance.status),
            message: createA2AMessage({
                role: 'agent',
                contextId,
                taskId: instance.id,
                text: instance.error || `Pipeline ${instance.pipelineId} is ${instance.status}.`,
                metadata: {
                    pipelineId: instance.pipelineId,
                    status: instance.status,
                },
            }),
            timestamp: new Date(instance.completedAt || instance.startedAt).toISOString(),
        },
        artifacts,
        history: Array.from(instance.surfaceResults.values()).map((result) => createA2AMessage({
            role: 'agent',
            contextId,
            taskId: instance.id,
            text: `${result.surfaceId}: ${result.status}${result.error ? ` - ${result.error}` : ''}`,
            metadata: {
                surfaceId: result.surfaceId,
                status: result.status,
            },
        })),
        metadata: {
            pipelineId: instance.pipelineId,
            currentSurface: instance.currentSurface,
            coordination: instance.coordination,
            startedAt: instance.startedAt,
            completedAt: instance.completedAt,
        },
    };
}
export function surfaceResultToA2AArtifact(result) {
    return {
        artifactId: `artifact-${result.surfaceId}`,
        name: result.surfaceId,
        description: `Surface artifact from ${result.surfaceId}`,
        parts: [
            createA2ADataPart(result.artifacts || {}, {
                surfaceId: result.surfaceId,
                status: result.status,
            }),
        ],
        metadata: {
            surfaceId: result.surfaceId,
            status: result.status,
            startedAt: result.startedAt,
            completedAt: result.completedAt,
            tokenUsage: result.tokenUsage,
        },
    };
}
export function pipelineStatusToA2AState(status) {
    switch (status) {
        case 'pending':
            return 'submitted';
        case 'running':
        case 'paused':
            return 'working';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'canceled';
        case 'rolled_back':
            return 'failed';
        default:
            return 'unknown';
    }
}
export function surfaceStatusToA2AState(status) {
    switch (status) {
        case 'pending':
        case 'waiting':
            return 'submitted';
        case 'running':
            return 'working';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'canceled';
        case 'skipped':
            return 'rejected';
        default:
            return 'unknown';
    }
}
export function partsToText(parts) {
    return parts.map((part) => {
        if (part.kind === 'text')
            return part.text;
        if (part.kind === 'data')
            return JSON.stringify(part.data);
        return part.uri || part.name || part.bytes || '';
    }).filter(Boolean).join('\n');
}
function inferAgentMessageType(message) {
    const kind = String(message.metadata?.kind || message.metadata?.type || '').toLowerCase();
    if (kind === 'task' || kind === 'task_assign')
        return 'task_assign';
    if (kind === 'status' || kind === 'status_update')
        return 'status_update';
    if (kind === 'tool' || kind === 'tool_call')
        return 'tool_call';
    if (kind === 'meeting' || kind === 'meeting_round')
        return 'meeting_round';
    return 'chat';
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || `skill-${Date.now()}`;
}
//# sourceMappingURL=converters.js.map