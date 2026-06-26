import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

/**
 * /api/team — 多 Agent 协作端点
 * POST { goal }
 *
 * 使用 Gateway 的 TeamOrchestrator 编排：
 * 协调员分析目标 → 拆解任务 DAG → 分配给合适的 Agent → 汇总结果
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { goal } = body;

    if (!goal) {
      return NextResponse.json({ error: 'goal is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000); // 10 分钟超时

    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: goal }],
        mode: 'team',
        sessionId: `team-${Date.now()}`,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Gateway returned ${res.status}: ${errBody}` },
        { status: res.status },
      );
    }

    const data = await res.json();

    return NextResponse.json({
      goal,
      mode: 'team',
      content: data.choices?.[0]?.message?.content || 'No response',
      agent: data.instance || 'team',
      routedBy: data.routedBy || 'team-orchestrator',
      sessionId: data.sessionId,
      timestamp: Date.now(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message.includes('abort')) {
      return NextResponse.json({ error: 'Team orchestration timed out' }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Team failed: ${message}` },
      { status: 503 },
    );
  }
}
