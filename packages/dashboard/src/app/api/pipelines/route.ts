import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY_URL}/pipelines`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to reach gateway: ${message}` }, { status: 503 });
  }
}
