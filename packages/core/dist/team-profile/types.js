export function materializeTeamAgents(profile, options = {}) {
    const model = options.model || process.env.MODEL_NAME || 'mimo-v2.5-pro';
    const apiKey = options.apiKey || process.env.API_KEY || '';
    const baseUrl = options.baseUrl || process.env.MODEL_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1';
    const guide = options.communicationGuide || buildTeamCommunicationGuide(profile);
    return profile.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        systemPrompt: `${agent.systemPrompt}${guide}`,
        model,
        apiKey,
        baseUrl,
        expertise: agent.expertise,
        tools: agent.tools,
        typicalTasks: agent.typicalTasks,
    }));
}
export function buildTeamCommunicationGuide(profile) {
    const members = profile.agents.map((agent) => agent.id).join(', ');
    const exampleTarget = profile.defaultAgentId;
    return [
        '',
        '',
        'Team communication:',
        'Use the team messaging tool when another Role Agent needs context, review, or a handoff.',
        `- send_message({ to: "${exampleTarget}", content: "..." }) sends a message to one Role Agent.`,
        '- send_message({ to: "*", content: "..." }) broadcasts to the team.',
        `Available Role Agents: ${members}.`,
        'Treat messages as coordination notes; durable decisions and artifacts should be captured in documents, tasks, or pipeline outputs.',
    ].join('\n');
}
export function getProfileAgent(profile, agentId) {
    return profile.agents.find((agent) => agent.id === agentId);
}
//# sourceMappingURL=types.js.map