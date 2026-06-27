import { NextResponse } from 'next/server';
import { deleteCustomAgent, updateCustomAgentModel } from '@/lib/custom-agents';

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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const body = await request.json();
    if (body?.action !== 'set-model') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
    const agent = await updateCustomAgentModel(
      decodeURIComponent(params.id),
      String(body.modelId || ''),
      {
        provider: String(body.modelConfig?.provider || ''),
        model: String(body.modelConfig?.model || ''),
        baseUrl: String(body.modelConfig?.baseUrl || body.modelConfig?.apiEndpoint || ''),
        apiKey: String(body.modelConfig?.apiKey || ''),
      },
    );
    return NextResponse.json({ agent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update custom agent' },
      { status: 400 },
    );
  }
}
