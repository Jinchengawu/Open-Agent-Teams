import { NextResponse } from 'next/server';
import { deleteCustomAgent } from '@/lib/custom-agents';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const deleted = await deleteCustomAgent(decodeURIComponent(id));
  if (!deleted) {
    return NextResponse.json({ error: 'Custom agent not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
