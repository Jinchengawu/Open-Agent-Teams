import { NextRequest, NextResponse } from 'next/server';

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
    const { messages, agentId, sessionId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    const targetAgent = agentId || 'backend';
    const port = AGENT_PORTS[targetAgent];
    if (!port) {
      return NextResponse.json(
        { error: `Unknown agent: ${targetAgent}` },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);

    const res = await fetch(
      `http://localhost:${port}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, sessionId }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Agent returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      message: {
        role: 'assistant' as const,
        content: data.choices?.[0]?.message?.content || 'No response',
      },
      agent: targetAgent,
      sessionId: data.sessionId || sessionId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message.includes('abort')) {
      return NextResponse.json(
        { error: 'Request timed out' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: `Failed to reach agent: ${message}` },
      { status: 503 }
    );
  }
}
