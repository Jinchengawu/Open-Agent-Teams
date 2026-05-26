import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('http://localhost:8202/v1/sessions', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ sessions: [], error: `Agent returned ${res.status}` });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ sessions: [], error: 'Backend agent not available' });
  }
}
