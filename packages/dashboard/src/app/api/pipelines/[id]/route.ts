import { NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${GATEWAY_URL}/pipelines/${encodeURIComponent(params.id)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to reach gateway: ${message}`, deleted: false }, { status: 503 });
  }
}
