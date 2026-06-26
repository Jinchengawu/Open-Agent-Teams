import { NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/templates`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ templates: [], error: `Gateway returned ${res.status}` });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ templates: [], error: 'Gateway not available' });
  }
}
