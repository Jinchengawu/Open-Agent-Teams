import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, sessionId, mode, agentId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages is required and must be a non-empty array' },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);

    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, sessionId, mode, agentId, attachments: body.attachments || [] }),
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
      message: {
        role: 'assistant' as const,
        content: data.choices?.[0]?.message?.content || 'No response',
      },
      agent: data.instance || 'unknown',
      sessionId: data.sessionId || sessionId,
      routedBy: data.routedBy || 'gateway',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message.includes('abort')) {
      return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Failed to reach gateway: ${message}` },
      { status: 503 },
    );
  }
}
