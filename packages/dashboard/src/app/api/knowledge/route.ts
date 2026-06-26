import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const type = searchParams.get('type') || '';
    const source = searchParams.get('source') || '';
    const projectId = searchParams.get('projectId') || '';
    const taskId = searchParams.get('taskId') || '';
    const authorId = searchParams.get('authorId') || '';
    const sortBy = searchParams.get('sortBy') || '';
    const sortOrder = searchParams.get('sortOrder') || '';
    const limit = searchParams.get('limit') || '50';
    const offset = searchParams.get('offset') || '0';

    let url: string;
    const hasDocumentContext = Boolean(projectId || taskId || authorId || sortBy || sortOrder);
    if (hasDocumentContext) {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (projectId) params.set('projectId', projectId);
      if (taskId) params.set('taskId', taskId);
      if (type) params.set('type', type);
      if (authorId && !q) params.set('authorId', authorId);
      if (sortBy && !q) params.set('sortBy', sortBy);
      if (sortOrder && !q) params.set('sortOrder', sortOrder);
      params.set('limit', limit);
      if (!q) params.set('offset', offset);
      url = `${GATEWAY_URL}${q ? '/api/v2/documents/search' : '/api/v2/documents'}?${params.toString()}`;
    } else if (q) {
      url = `${GATEWAY_URL}/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`;
      if (type) url += `&type=${encodeURIComponent(type)}`;
    } else {
      url = `${GATEWAY_URL}/knowledge?limit=${limit}&offset=${offset}`;
      if (type) url += `&type=${encodeURIComponent(type)}`;
      if (source) url += `&source=${encodeURIComponent(source)}`;
    }

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch knowledge' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to reach gateway: ${message}` }, { status: 503 });
  }
}
