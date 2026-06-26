import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const query = request.nextUrl.searchParams.toString();
    const res = await fetch(`${GATEWAY_URL}/v1/workflows${query ? `?${query}` : ''}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ workflows: [], error: `Gateway returned ${res.status}` });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ workflows: [], error: 'Gateway not available' });
  }
}
