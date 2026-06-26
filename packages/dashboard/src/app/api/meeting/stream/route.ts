import { NextRequest } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

/**
 * /api/meeting/stream — SSE 流式会议端点
 * POST { message, topicId?, sessionId? }
 *
 * 透传 Gateway 的 SSE 流，前端可逐 Agent 获取进度
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, topicId, sessionId } = body;

    if (!message) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sid = sessionId || `meeting-${topicId || Date.now()}`;

    const gatewayRes = await fetch(`${GATEWAY_URL}/v1/meeting/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId: sid, topicId }),
    });

    if (!gatewayRes.ok) {
      const errBody = await gatewayRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: `Gateway returned ${gatewayRes.status}: ${errBody}` }), {
        status: gatewayRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 透传 SSE 流
    return new Response(gatewayRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `Meeting stream failed: ${msg}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
