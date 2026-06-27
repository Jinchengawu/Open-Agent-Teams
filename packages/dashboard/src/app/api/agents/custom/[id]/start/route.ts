import { NextResponse } from 'next/server';
import { startCustomAgent } from '@/lib/custom-agents';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const agent = await startCustomAgent(decodeURIComponent(params.id));
    return NextResponse.json({ agent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start custom agent' },
      { status: 400 },
    );
  }
}
