import { NextRequest } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

type RouteContext = {
  params: {
    path?: string[];
  };
};

async function proxy(request: NextRequest, context: RouteContext) {
  const path = context.params.path?.join('/') || '';
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`/api/v2/${path}`, GATEWAY_URL);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();

  try {
    const res = await fetch(targetUrl, {
      method,
      headers,
      body,
      cache: 'no-store',
    });

    if (res.status === 204) {
      return new Response(null, { status: 204 });
    }

    const responseBody = await res.text();
    return new Response(responseBody, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: `Failed to reach gateway: ${message}` }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
