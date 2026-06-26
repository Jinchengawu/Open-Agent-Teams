import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${GATEWAY_URL}/pipeline-instances/${params.id}/coordination`, {
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to reach gateway: ${message}` }, { status: 503 });
  }
}
