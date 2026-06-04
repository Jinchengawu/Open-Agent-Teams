import { NextRequest, NextResponse } from 'next/server';

// Agent 消息端点映射
const AGENT_PORTS: Record<string, number> = {
  frontend: 8201,
  backend: 8202,
  testing: 8203,
  devops: 8204,
  pm: 8205,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, agents, mode } = body;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // 默认全部 Agent
    const targets = (agents as string[]) || Object.keys(AGENT_PORTS);
    const validTargets = targets.filter((a) => AGENT_PORTS[a]);

    if (validTargets.length === 0) {
      return NextResponse.json({ error: 'No valid agents specified' }, { status: 400 });
    }

    if (mode === 'meeting') {
      // 🎙️ 会议模式 — 所有 Agent 顺序发言，共享上下文
      const discussion: string[] = [];
      const responses: { agent: string; role: 'assistant'; content: string }[] = [];

      for (const agentId of validTargets) {
        const port = AGENT_PORTS[agentId];
        const contextSection = discussion.length > 0
          ? `\n\n## 会议讨论记录（之前的发言）\n${discussion.join('\n\n')}`
          : '';
        const prompt = `## 会议议题\n${message}${contextSection}\n\n请从你的专业角度发表意见。简洁有力，突出重点。`;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: prompt }],
              sessionId: `meeting-${Date.now()}-${agentId}`,
            }),
            signal: AbortSignal.timeout(300000),
          });

          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || 'No response';
          responses.push({ agent: agentId, role: 'assistant', content });
          discussion.push(`### ${agentId}\n${content}`);
        } catch (e) {
          const content = `Error: ${e instanceof Error ? e.message : 'unknown'}`;
          responses.push({ agent: agentId, role: 'assistant', content });
        }
      }

      return NextResponse.json({ message, mode: 'meeting', responses, timestamp: Date.now() });
    }

    // 📢 Broadcast 模式 — 并发发送到多个 Agent
    const results = await Promise.allSettled(
      validTargets.map(async (agentId) => {
        const port = AGENT_PORTS[agentId];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000);

        try {
          const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: message }],
              sessionId: `collab-${Date.now()}-${agentId}`,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeout);
          const data = await res.json();
          return {
            agent: agentId,
            role: 'assistant' as const,
            content: data.choices?.[0]?.message?.content || 'No response',
          };
        } catch (e) {
          clearTimeout(timeout);
          return {
            agent: agentId,
            role: 'system' as const,
            content: `Error: ${e instanceof Error ? e.message : 'unknown'}`,
          };
        }
      })
    );

    const responses = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { agent: 'unknown', role: 'system' as const, content: `Error: ${r.reason}` }
    );

    return NextResponse.json({ message, responses, timestamp: Date.now() });
  } catch (e) {
    return NextResponse.json(
      { error: `Collaboration failed: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 }
    );
  }
}
