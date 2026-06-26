import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${GATEWAY_URL}/v1/pipeline/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        options: {
          dryRun: true,
          surfaceTimeoutMs: 90_000,
          ...body.options,
        },
      }),
      cache: 'no-store',
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to reach gateway: ${message}` }, { status: 503 });
  }
}
