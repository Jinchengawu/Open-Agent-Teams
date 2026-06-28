'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Scenario = {
  id: string;
  title: string;
  description: string;
};

type SessionState = Record<string, any>;

const SCENARIOS: Scenario[] = [
  { id: 'software_delivery', title: '软件项目交付团队', description: '需求、PRD、看板、开发、测试、发布、复盘。' },
  { id: 'code_audit', title: '代码审计团队', description: '仓库接入、风险分类、证据定位、修复建议、审计报告。' },
  { id: 'rag_review', title: 'RAG 知识评审团队', description: '资料导入、切分、检索评估、答案验证、质量报告。' },
  { id: 'content_audit', title: '内容/图片审核团队', description: '规则理解、OCR/视觉识别、案例检索、人工复核。' },
  { id: 'data_report', title: '数据分析报告团队', description: '指标定义、分析、可视化、洞察报告。' },
  { id: 'support_ticket', title: '客服工单处理团队', description: '分诊、知识库检索、答复草稿、升级交接。' },
  { id: 'custom', title: '自定义业务流程', description: '从你的真实流程中抽象 Agent、工作流和验收门禁。' },
];

const QUESTIONS = [
  { id: 'q_business', text: '你的团队主要交付什么类型的业务？', placeholder: '例如：企业后台系统、代码审计、图片内容审核' },
  { id: 'q_roles', text: '当前已有的核心角色有哪些？', placeholder: '例如：产品、前端、后端、测试、运维、法务' },
  { id: 'q_pain', text: '你希望 AI 先帮你解决哪个最痛的流程？', placeholder: '例如：需求拆不清、测试标准不统一、上线检查遗漏' },
  { id: 'q_approval', text: '哪些环节必须保留人工确认？', placeholder: '例如：需求冻结、生产发布、风险例外、客户交付' },
  { id: 'q_outputs', text: '你希望最终产出什么交付物？', placeholder: '例如：PRD、任务、测试报告、发布计划、复盘' },
];

export default function TeamArchitectPage() {
  const [scenario, setScenario] = useState('software_delivery');
  const [projectName, setProjectName] = useState('我的 AI 业务协作团队');
  const [answers, setAnswers] = useState<Record<string, string>>({
    q_business: '软件项目交付',
    q_roles: 'PM、Frontend、Backend、Testing、DevOps、Project Admin',
    q_pain: '把需求快速转成可执行任务并完成验证闭环',
    q_approval: '需求冻结、发布前检查、风险例外',
    q_outputs: 'Team Blueprint、Agent Specs、Workflow、Kanban Seed、Knowledge Seed、Validation Report',
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const progress = useMemo(() => {
    const completed = [
      session,
      session?.draftBlueprint,
      session?.agentSpecs,
      session?.workflow,
      session?.applied,
      session?.validation,
    ].filter(Boolean).length;
    return `${completed}/6`;
  }, [session]);

  async function api(path: string, body?: unknown) {
    const res = await fetch(`/api/team-architect/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function runStep(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setBusy('');
    }
  }

  async function startSession() {
    await runStep('创建初始化会话', async () => {
      const created = await api('sessions', { businessScenario: scenario, projectName });
      setSession(created.session);
    });
  }

  async function generateAll() {
    await runStep('生成团队资产', async () => {
      let current = session;
      if (!current) {
        const created = await api('sessions', { businessScenario: scenario, projectName });
        current = created.session;
        setSession(current);
      }
      const activeSession = current as SessionState;
      const submitted = await api(`sessions/${activeSession.id}/answers`, {
        answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
      });
      current = submitted.session;
      const generatedSession = current as SessionState;
      const blueprint = await api(`sessions/${generatedSession.id}/generate-blueprint`);
      const agents = await api(`sessions/${generatedSession.id}/generate-agents`);
      const workflow = await api(`sessions/${generatedSession.id}/generate-workflow`);
      setSession({ ...workflow.session, draftBlueprint: blueprint.blueprint, agentSpecs: agents.agents, promptPack: agents.promptPack, skillMap: agents.skillMap });
    });
  }

  async function applyConfig() {
    if (!session) return;
    await runStep('应用配置并验证', async () => {
      const applied = await api(`sessions/${session.id}/apply`, {
        applyAgents: true,
        applyWorkflow: true,
        applyKanban: true,
        applyKnowledge: true,
        overwriteExisting: false,
      });
      setSession(applied.session);
    });
  }

  const generatedAgents = session?.agentSpecs || [];
  const workflowStages = session?.workflow?.stages || [];
  const checks = session?.validation?.checks || session?.applied?.validation?.checks || [];

  return (
    <div className="space-y-6" data-testid="team-architect-page">
      <section className="rounded-lg border border-slate-200 bg-white/75 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#007f96]">Team Architect Agent</p>
            <h1 className="mt-2 text-3xl font-black text-[#111820] md:text-5xl">初始化我的 AI 团队</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              团队架构师 Agent 会把真实组织、业务流程和协作习惯转换成 Team Blueprint、Agent Specs、Workflow、Kanban Seed 和 Knowledge Seed。
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-right">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">初始化进度</p>
            <p className="mt-1 text-2xl font-black text-[#111820]">{progress}</p>
            <p className="mt-1 text-xs text-slate-500">{busy || '等待操作'}</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>1. 业务场景</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="团队或项目名称"
            />
            <div className="space-y-2" data-testid="team-architect-scenario-list">
              {SCENARIOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScenario(item.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    scenario === item.id ? 'border-[#007f96] bg-cyan-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-[#111820]">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{item.description}</div>
                </button>
              ))}
            </div>
            <Button className="w-full" onClick={startSession} disabled={Boolean(busy)}>
              创建初始化会话
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>2. 分阶段问答</CardTitle>
            <Badge className="border-cyan-200 bg-cyan-50 text-cyan-700">每轮少量问题</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {QUESTIONS.map((question) => (
              <label key={question.id} className="block">
                <span className="text-sm font-bold text-[#111820]">{question.text}</span>
                <textarea
                  className="mt-2 min-h-[74px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  value={answers[question.id] || ''}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  placeholder={question.placeholder}
                />
              </label>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button onClick={generateAll} disabled={Boolean(busy)} data-testid="team-architect-generate">
                生成团队蓝图
              </Button>
              <Button variant="outline" onClick={applyConfig} disabled={Boolean(busy) || !session?.workflow} data-testid="team-architect-apply">
                确认并应用配置
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="team-architect-assets">
          <CardHeader>
            <CardTitle>实时生成资产</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ['Team Blueprint', session?.draftBlueprint ? 'ready' : 'pending'],
              ['Agent Specs', generatedAgents.length ? `${generatedAgents.length} agents` : 'pending'],
              ['Workflow Template', workflowStages.length ? `${workflowStages.length} stages` : 'pending'],
              ['Kanban Seed', session?.kanbanSeed?.length ? `${session.kanbanSeed.length} tasks` : 'pending'],
              ['Knowledge Seed', session?.knowledgeSeed?.length ? `${session.knowledgeSeed.length} docs` : 'pending'],
              ['Validation Report', checks.length ? `${checks.length} checks` : 'pending'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold text-[#111820]">{label}</span>
                <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{value}</span>
              </div>
            ))}
            {session?.applied?.created && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="team-architect-created">
                <p className="font-black">已应用</p>
                <p className="mt-1">文档 {session.applied.created.documentIds.length} · 任务 {session.applied.created.taskIds.length}</p>
                <div className="mt-2 flex gap-2">
                  <Link className="font-bold text-[#007f96]" href={`/knowledge?projectId=${encodeURIComponent(session.applied.created.projectId)}`}>查看 Knowledge</Link>
                  <Link className="font-bold text-[#007f96]" href="/kanban?source=local">查看 Kanban</Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Team Blueprint</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[420px] overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-5 text-slate-100">
              {JSON.stringify(session?.draftBlueprint || { hint: '点击“生成团队蓝图”后展示' }, null, 2)}
            </pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>初始化验证</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2" data-testid="team-architect-validation">
            {checks.length === 0 ? (
              <p className="text-sm text-slate-500">应用配置后会生成验证报告。</p>
            ) : checks.map((check: any) => (
              <div key={check.id} className={`rounded-md border px-3 py-2 ${
                check.status === 'pass' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : check.status === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-red-200 bg-red-50 text-red-800'
              }`}>
                <div className="text-sm font-black">{check.id}</div>
                <div className="text-xs">{check.message}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
