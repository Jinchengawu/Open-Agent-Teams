import { NextRequest, NextResponse } from 'next/server';
import {
  applyTeamArchitectSession,
  createTeamArchitectSession,
  generateAndSaveAgents,
  generateAndSaveBlueprint,
  generateAndSaveWorkflow,
  getTeamArchitectQuestions,
  getTeamArchitectSession,
  listTeamArchitectSessions,
  submitTeamArchitectAnswers,
  validateTeamArchitectSession,
  type BusinessScenario,
} from '@/lib/team-architect';

export const runtime = 'nodejs';

type RouteContext = {
  params: {
    path?: string[];
  };
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function isSessionPath(path: string[], action: string) {
  return path.length === 3 && path[0] === 'sessions' && path[2] === action;
}

async function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Team Architect request failed';
  return json({ ok: false, error: message }, message.includes('not found') ? 404 : 400);
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const path = context.params.path || [];
    if (path.length === 0) {
      return json({
        ok: true,
        agent: {
          id: 'system-team-architect',
          name: 'Team Architect Agent',
          label: '团队架构师 Agent',
          role: '团队初始化、业务流程迁移、Agent Specs、Workflow、Kanban 与 Knowledge Seed 生成',
        },
        scenarios: [
          'software_delivery',
          'code_audit',
          'rag_review',
          'content_audit',
          'data_report',
          'support_ticket',
          'custom',
        ],
        questions: getTeamArchitectQuestions(),
      });
    }

    if (path.length === 1 && path[0] === 'sessions') {
      return json({ ok: true, sessions: await listTeamArchitectSessions() });
    }

    if (path.length === 2 && path[0] === 'sessions') {
      const session = await getTeamArchitectSession(path[1]);
      if (!session) return json({ ok: false, error: 'Team Architect session not found' }, 404);
      return json({ ok: true, session });
    }

    return json({ ok: false, error: 'Unknown Team Architect endpoint' }, 404);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const path = context.params.path || [];
    const body = await request.json().catch(() => ({}));

    if (path.length === 1 && path[0] === 'sessions') {
      const result = await createTeamArchitectSession({
        businessScenario: body.businessScenario as BusinessScenario | undefined,
        projectName: typeof body.projectName === 'string' ? body.projectName : undefined,
      });
      return json({ ok: true, ...result }, 201);
    }

    if (isSessionPath(path, 'answers')) {
      const result = await submitTeamArchitectAnswers(path[1], Array.isArray(body.answers) ? body.answers : []);
      return json({ ok: true, ...result });
    }

    if (isSessionPath(path, 'generate-blueprint')) {
      const session = await generateAndSaveBlueprint(path[1]);
      return json({ ok: true, session, blueprint: session.draftBlueprint, warnings: session.draftBlueprint?.warnings || [], recommendations: session.draftBlueprint?.recommendations || [] });
    }

    if (isSessionPath(path, 'generate-agents')) {
      const session = await generateAndSaveAgents(path[1]);
      return json({ ok: true, session, agents: session.agentSpecs, promptPack: session.promptPack, skillMap: session.skillMap });
    }

    if (isSessionPath(path, 'generate-workflow')) {
      const session = await generateAndSaveWorkflow(path[1]);
      return json({ ok: true, session, workflow: session.workflow, kanbanSeed: session.kanbanSeed, knowledgeSeed: session.knowledgeSeed });
    }

    if (isSessionPath(path, 'apply')) {
      const session = await applyTeamArchitectSession(path[1], {
        applyAgents: body.applyAgents !== false,
        applyWorkflow: body.applyWorkflow !== false,
        applyKanban: body.applyKanban !== false,
        applyKnowledge: body.applyKnowledge !== false,
        overwriteExisting: body.overwriteExisting === true,
      });
      return json({ ok: session.applied?.ok ?? false, session, created: session.applied?.created, validation: session.applied?.validation });
    }

    if (isSessionPath(path, 'validate')) {
      const session = await validateTeamArchitectSession(path[1]);
      return json({ ok: session.validation?.ok ?? false, session, validation: session.validation });
    }

    return json({ ok: false, error: 'Unknown Team Architect endpoint' }, 404);
  } catch (error) {
    return handleError(error);
  }
}
