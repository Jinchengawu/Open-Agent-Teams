import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.toString();
    const res = await fetch(`${GATEWAY_URL}/pipeline-instances${query ? `?${query}` : ''}`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch instances' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to reach gateway: ${message}` }, { status: 503 });
  }
}
