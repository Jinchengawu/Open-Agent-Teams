import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

/**
 * /api/collab — 多 Agent 协作端点
 * POST { message, agents?: string[], mode?: 'team' | 'broadcast' | 'meeting', topicId?: string }
 *
 * mode:
 *   - 'team': 协调员自动拆解任务（默认）
 *   - 'broadcast': 广播给所有 Agent，并发执行
 *   - 'meeting': 圆桌会议，顺序发言，共享上下文
 *
 * topicId: 会议议题 ID，用于上下文隔离（meeting 模式专用）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, mode: bodyMode, topicId } = body;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const mode = bodyMode || 'team';

    // sessionId 策略：meeting 按议题复用，其他模式每次新建
    const sessionId = (mode === 'meeting' && topicId)
      ? `meeting-${topicId}`
      : `${mode}-${Date.now()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000); // 10 分钟超时

    // broadcast 模式映射为 team 模式（Gateway 不区分）
    const gatewayMode = mode === 'broadcast' ? 'team' : mode;

    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        mode: gatewayMode,
        sessionId,
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
      message,
      mode,
      content: data.choices?.[0]?.message?.content || 'No response',
      agent: data.instance || mode,
      routedBy: data.routedBy || `${mode}-orchestrator`,
      sessionId: data.sessionId,
      timestamp: Date.now(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message.includes('abort')) {
      return NextResponse.json({ error: 'Collaboration timed out' }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Collaboration failed: ${message}` },
      { status: 503 },
    );
  }
}
