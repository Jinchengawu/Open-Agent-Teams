import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('http://localhost:8205/v1/workflows', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ workflows: [], error: `PM agent returned ${res.status}` });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ workflows: [], error: 'PM agent not available' });
  }
}
