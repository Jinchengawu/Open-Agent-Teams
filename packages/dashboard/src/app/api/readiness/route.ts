import { access, readFile } from 'fs/promises';
import { resolve } from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROOT = resolve(process.cwd(), '../..');

const REQUIRED_FILES = [
  'packages/dashboard/src/app/kanban/page.tsx',
  'packages/dashboard/src/app/pipeline/page.tsx',
  'packages/dashboard/src/app/knowledge/page.tsx',
  'packages/dashboard/src/app/api/kanban/route.ts',
  'packages/dashboard/src/app/api/knowledge/route.ts',
  'packages/dashboard/src/app/api/pipelines/route.ts',
  'packages/dashboard/src/app/api/pipeline-instances/route.ts',
  'packages/dashboard/src/app/api/milestones/route.ts',
  'packages/dashboard/src/app/api/readiness/route.ts',
  'packages/dashboard/src/app/api/snapshots/route.ts',
  'packages/core/src/knowledge/DocumentManager.ts',
  'packages/core/src/tools/document-tools-v2.ts',
  'packages/core/src/pipeline/Orchestrator.ts',
  'packages/core/src/session/WorkflowStateManager.ts',
  'packages/gateway/src/api-gateway.ts',
  'docs/open-agent-teams/framework-sync-policy.md',
];

async function assertFileExists(relativePath: string): Promise<void> {
  await access(resolve(ROOT, relativePath));
}

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(resolve(ROOT, relativePath), 'utf8');
}

export async function GET() {
  try {
    await Promise.all(REQUIRED_FILES.map(assertFileExists));

    const [constants, i18n, gateway] = await Promise.all([
      readRepoFile('packages/dashboard/src/lib/constants.ts'),
      readRepoFile('packages/dashboard/src/lib/i18n.tsx'),
      readRepoFile('packages/gateway/src/api-gateway.ts'),
    ]);

    if (!constants.includes('nav.kanban') && !i18n.includes('nav.kanban')) {
      throw new Error('console navigation does not expose kanban');
    }

    if (!gateway.includes('pipeline-instances')) {
      throw new Error('pipeline instance API is not exposed');
    }

    return NextResponse.json({
      checkedAt: Date.now(),
      source: 'dashboard readiness static checks',
      ok: true,
      summary: 'Open-Agent-Teams framework sync baseline OK',
      checkedFiles: REQUIRED_FILES.length,
    });
  } catch (error: any) {
    return NextResponse.json({
      checkedAt: Date.now(),
      source: 'dashboard readiness static checks',
      ok: false,
      error: error instanceof Error ? error.message : 'Readiness check failed',
    }, { status: 503 });
  }
}
