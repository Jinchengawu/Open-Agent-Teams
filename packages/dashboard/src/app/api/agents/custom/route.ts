import { NextResponse } from 'next/server';
import { createCustomAgent, listCustomAgents } from '@/lib/custom-agents';

export const runtime = 'nodejs';

export async function GET() {
  const agents = await listCustomAgents();
  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = await createCustomAgent(body);
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create custom agent' },
      { status: 400 },
    );
  }
}
