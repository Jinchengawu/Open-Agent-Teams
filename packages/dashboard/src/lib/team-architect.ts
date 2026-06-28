import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export type BusinessScenario =
  | 'software_delivery'
  | 'code_audit'
  | 'rag_review'
  | 'content_audit'
  | 'data_report'
  | 'support_ticket'
  | 'custom';

export interface TeamArchitectAnswer {
  questionId: string;
  value: string | string[];
}

export interface TeamArchitectSession {
  id: string;
  businessScenario: BusinessScenario;
  projectName: string;
  answers: TeamArchitectAnswer[];
  draftBlueprint?: TeamBlueprint;
  agentSpecs?: AgentSpec[];
  promptPack?: PromptPack;
  skillMap?: SkillMapEntry[];
  workflow?: WorkflowTemplate;
  kanbanSeed?: KanbanSeedTask[];
  knowledgeSeed?: KnowledgeSeedDocument[];
  applied?: TeamArchitectApplyResult;
  validation?: TeamArchitectValidation;
  createdAt: string;
  updatedAt: string;
}

export interface TeamBlueprint {
  id: string;
  name: string;
  businessDomain: BusinessScenario;
  summary: string;
  agents: string[];
  workflows: string[];
  humanApprovalPoints: string[];
  knowledgeTypes: string[];
  validationChecklist: string[];
  recommendations: string[];
  warnings: string[];
  createdAt: string;
  version: number;
}

export interface AgentSpec {
  id: string;
  name: string;
  role: string;
  responsibilities: string[];
  inputs: string[];
  outputs: string[];
  systemPrompt: string;
  skills: string[];
  tools: string[];
  collaborationRules: string[];
  qualityChecklist: string[];
  escalationRules: string[];
}

export interface PromptPack {
  systemPrompt: string;
  collaborationPrompt: string;
  outputFormat: string;
  qualityChecklist: string[];
  providerSafeNote: string;
}

export interface SkillMapEntry {
  agentId: string;
  requiredSkills: string[];
  missingSkills: string[];
  recommendedSkills: string[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  stages: Array<{
    id: string;
    name: string;
    ownerAgentId: string;
    outputs: string[];
    requiresHumanApproval: boolean;
  }>;
  yaml: string;
}

export interface KanbanSeedTask {
  title: string;
  description: string;
  assignee: string;
  priority: 'low' | 'medium' | 'high';
  task_type: string;
  tags: string[];
}

export interface KnowledgeSeedDocument {
  title: string;
  type: 'prd' | 'tech_spec' | 'meeting' | 'report' | 'task' | 'general' | 'review' | 'code_review';
  content: string;
  tags: string[];
}

export interface TeamArchitectApplyResult {
  ok: boolean;
  created: {
    agents: string[];
    workflowId?: string;
    projectId: string;
    documentIds: string[];
    taskIds: string[];
  };
  validation: TeamArchitectValidation;
}

export interface TeamArchitectValidation {
  ok: boolean;
  checks: Array<{
    id: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
  }>;
}

interface Store {
  sessions: TeamArchitectSession[];
}

const STORE_PATH =
  process.env.OPEN_AGENT_TEAM_ARCHITECT_FILE ||
  process.env.DEV_AGENT_TEAM_ARCHITECT_FILE ||
  join(process.env.OPEN_AGENT_DATA_DIR || process.env.DEV_AGENT_DATA_DIR || join(homedir(), '.open-agent-teams/data'), 'team-architect.json');
const SESSION_DB_PATH = process.env.SESSION_DB_PATH || join(process.env.OPEN_AGENT_DATA_DIR || join(homedir(), '.open-agent-teams/data'), 'sessions.db');
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

const SCENARIO_LABELS: Record<BusinessScenario, string> = {
  software_delivery: '软件项目交付团队',
  code_audit: '代码审计团队',
  rag_review: 'RAG 知识评审团队',
  content_audit: '内容/图片审核团队',
  data_report: '数据分析报告团队',
  support_ticket: '客服工单处理团队',
  custom: '自定义业务团队',
};

const SCENARIO_AGENTS: Record<BusinessScenario, Array<{ id: string; name: string; role: string; skills: string[] }>> = {
  software_delivery: [
    { id: 'ta-pm', name: '产品经理 Agent', role: '需求澄清、PRD、用户故事和验收范围', skills: ['prd', 'requirement-analysis', 'user-story'] },
    { id: 'ta-architect', name: '架构设计 Agent', role: '技术方案、边界拆分、风险识别', skills: ['architecture-review', 'api-design', 'risk-review'] },
    { id: 'ta-frontend', name: '前端开发 Agent', role: '界面实现、交互体验、前端验收', skills: ['frontend-planning', 'ui-review', 'component-design'] },
    { id: 'ta-backend', name: '后端开发 Agent', role: '服务接口、数据模型、集成方案', skills: ['backend-planning', 'database-design', 'integration'] },
    { id: 'ta-testing', name: '测试质量 Agent', role: '测试计划、验收用例、回归报告', skills: ['test-plan', 'e2e-verification', 'regression-report'] },
    { id: 'ta-devops', name: 'DevOps Agent', role: '发布准备、环境、回滚和监控', skills: ['release-readiness', 'ci-cd', 'rollback-plan'] },
    { id: 'ta-admin', name: '项目管理员 Agent', role: '看板、里程碑、阻塞跟踪和复盘', skills: ['kanban-planning', 'milestone', 'retrospective'] },
  ],
  code_audit: [
    { id: 'ta-code-reader', name: '代码理解 Agent', role: '仓库结构理解和模块摘要', skills: ['repo-map', 'code-reading'] },
    { id: 'ta-security', name: '安全审计 Agent', role: '漏洞、权限和数据安全风险审计', skills: ['security-audit', 'risk-evidence'] },
    { id: 'ta-test-coverage', name: '测试覆盖 Agent', role: '测试缺口、回归策略和质量建议', skills: ['coverage-review', 'test-gap'] },
    { id: 'ta-report', name: '审计报告 Agent', role: '证据汇总、修复建议和报告输出', skills: ['audit-report', 'remediation-plan'] },
  ],
  rag_review: [
    { id: 'ta-doc-parser', name: '文档解析 Agent', role: '资料解析、章节切分和结构整理', skills: ['document-parse', 'chunking'] },
    { id: 'ta-retrieval', name: '检索评估 Agent', role: '召回质量、引用覆盖和相似案例评估', skills: ['retrieval-eval', 'citation-check'] },
    { id: 'ta-answer-quality', name: '答案质量 Agent', role: '答案一致性、事实性和可解释性评估', skills: ['answer-eval', 'grounding'] },
    { id: 'ta-rag-report', name: '评估报告 Agent', role: '评估结论、改进建议和发布报告', skills: ['eval-report', 'quality-gate'] },
  ],
  content_audit: [
    { id: 'ta-rule', name: '规则理解 Agent', role: '规则解释、风险分类和适用边界', skills: ['policy-reading', 'risk-taxonomy'] },
    { id: 'ta-vision', name: '图像理解 Agent', role: 'OCR、图像实体和视觉风险识别', skills: ['ocr', 'vision-understanding'] },
    { id: 'ta-case', name: '案例检索 Agent', role: '历史案例匹配和相似证据检索', skills: ['case-retrieval', 'evidence-match'] },
    { id: 'ta-review', name: '人工复核 Agent', role: '人工确认点、质检抽样和复盘', skills: ['human-review', 'qa-report'] },
  ],
  data_report: [
    { id: 'ta-data-analyst', name: '数据分析 Agent', role: '指标定义、数据解释和异常识别', skills: ['metric-design', 'data-analysis'] },
    { id: 'ta-visualization', name: '可视化 Agent', role: '图表结构和汇报表达', skills: ['chart-design', 'dashboard-story'] },
    { id: 'ta-insight', name: '洞察报告 Agent', role: '业务洞察、建议和报告生成', skills: ['insight-report', 'decision-support'] },
  ],
  support_ticket: [
    { id: 'ta-triage', name: '工单分诊 Agent', role: '工单分类、优先级和路由', skills: ['ticket-triage', 'priority-routing'] },
    { id: 'ta-knowledge-support', name: '知识库 Agent', role: 'FAQ 检索、答案草稿和引用', skills: ['faq-search', 'answer-draft'] },
    { id: 'ta-escalation', name: '升级处理 Agent', role: '升级规则、人工交接和复盘', skills: ['escalation', 'handoff'] },
  ],
  custom: [
    { id: 'ta-domain-lead', name: '领域负责人 Agent', role: '业务目标、边界和验收标准', skills: ['domain-model', 'acceptance'] },
    { id: 'ta-process', name: '流程设计 Agent', role: '流程拆解、角色协作和任务映射', skills: ['workflow-design', 'kanban-planning'] },
    { id: 'ta-quality', name: '质量验证 Agent', role: '验证清单、风险和复盘', skills: ['quality-gate', 'retrospective'] },
  ],
};

const QUESTIONS = [
  { id: 'q_business', text: '你的团队主要交付什么类型的业务？' },
  { id: 'q_roles', text: '当前已有的核心角色有哪些？' },
  { id: 'q_pain', text: '你希望 AI 先帮你解决哪个最痛的流程？' },
  { id: 'q_approval', text: '哪些环节必须保留人工确认？' },
  { id: 'q_outputs', text: '你希望最终产出哪些交付物？' },
];

async function readStore(): Promise<Store> {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch {
    return { sessions: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52) || 'team';
}

function nowIso(): string {
  return new Date().toISOString();
}

function answerText(session: TeamArchitectSession, id: string, fallback: string): string {
  const value = session.answers.find((answer) => answer.questionId === id)?.value;
  if (Array.isArray(value)) return value.join('、') || fallback;
  return value || fallback;
}

export function getTeamArchitectQuestions() {
  return QUESTIONS;
}

export async function listTeamArchitectSessions(): Promise<TeamArchitectSession[]> {
  const store = await readStore();
  return [...store.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getTeamArchitectSession(id: string): Promise<TeamArchitectSession | null> {
  const store = await readStore();
  return store.sessions.find((session) => session.id === id) || null;
}

async function updateSession(id: string, updater: (session: TeamArchitectSession) => TeamArchitectSession): Promise<TeamArchitectSession> {
  const store = await readStore();
  const index = store.sessions.findIndex((session) => session.id === id);
  if (index === -1) throw new Error('Team Architect session not found');
  const updated = { ...updater(store.sessions[index]), updatedAt: nowIso() };
  store.sessions[index] = updated;
  await writeStore(store);
  return updated;
}

export async function createTeamArchitectSession(input: {
  businessScenario?: BusinessScenario;
  projectName?: string;
}): Promise<{ session: TeamArchitectSession; nextQuestions: typeof QUESTIONS }> {
  const scenario = input.businessScenario || 'software_delivery';
  const now = nowIso();
  const session: TeamArchitectSession = {
    id: `ta-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    businessScenario: scenario,
    projectName: input.projectName?.trim() || SCENARIO_LABELS[scenario],
    answers: [],
    createdAt: now,
    updatedAt: now,
  };
  const store = await readStore();
  store.sessions.unshift(session);
  await writeStore(store);
  return { session, nextQuestions: QUESTIONS };
}

export async function submitTeamArchitectAnswers(sessionId: string, answers: TeamArchitectAnswer[]) {
  const session = await updateSession(sessionId, (current) => {
    const merged = new Map(current.answers.map((answer) => [answer.questionId, answer]));
    for (const answer of answers) {
      merged.set(answer.questionId, answer);
    }
    return { ...current, answers: Array.from(merged.values()) };
  });
  return { session, nextQuestions: [], draftBlueprint: generateBlueprint(session) };
}

export function generateBlueprint(session: TeamArchitectSession): TeamBlueprint {
  const agents = SCENARIO_AGENTS[session.businessScenario];
  const projectName = session.projectName || SCENARIO_LABELS[session.businessScenario];
  const pain = answerText(session, 'q_pain', '先建立最小可运行交付闭环');
  const approval = answerText(session, 'q_approval', '需求确认、发布前确认、风险例外确认');
  const outputs = answerText(session, 'q_outputs', 'PRD、任务看板、工作流、验证报告、复盘文档');
  return {
    id: `blueprint-${slug(projectName)}-${Date.now()}`,
    name: projectName,
    businessDomain: session.businessScenario,
    summary: `${projectName} 的最小 Agent Teams 蓝图。优先解决：${pain}。目标产物：${outputs}。`,
    agents: agents.map((agent) => agent.id),
    workflows: [`workflow-${slug(projectName)}-minimum-loop`],
    humanApprovalPoints: approval.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
    knowledgeTypes: ['Team Blueprint', 'Agent Specs', 'Workflow Template', 'Migration Plan', 'Validation Report'],
    validationChecklist: [
      'Agent Specs 至少 3 个且职责不重叠',
      'Workflow Template 能进入 Team Coordination Loop',
      'Kanban Seed 能创建初始化任务',
      'Knowledge Seed 能写入初始化文档',
      '应用配置默认不覆盖已有 Agent',
    ],
    recommendations: [
      '先从最小可运行团队开始，避免一次创建过多 Agent。',
      '所有自动生成配置在应用前都需要人工确认。',
      '把 Prompt、Skill、Workflow 和验证报告写入 Knowledge，便于复盘。',
    ],
    warnings: agents.length > 6 ? ['团队规模较大，建议先启用核心 Agent，再按瓶颈扩容。'] : [],
    createdAt: nowIso(),
    version: 1,
  };
}

export function generateAgentSpecs(session: TeamArchitectSession): {
  agents: AgentSpec[];
  promptPack: PromptPack;
  skillMap: SkillMapEntry[];
} {
  const agents: AgentSpec[] = SCENARIO_AGENTS[session.businessScenario].map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    responsibilities: [
      agent.role,
      '明确输入、输出和质量标准',
      '与上下游 Agent 通过文档、看板和工作流交接',
    ],
    inputs: ['业务目标', '上下文文档', '相关任务', '人工确认点'],
    outputs: ['结构化分析', '可执行任务', '交付物草稿', '风险与下一步'],
    systemPrompt: [
      `你是 ${agent.name}。`,
      `职责：${agent.role}。`,
      '你必须输出结构化、可追踪、可交付的结果。',
      '你不能越权替代其他 Agent；遇到职责边界不清时必须说明需要哪个 Agent 协作。',
    ].join('\n'),
    skills: agent.skills,
    tools: ['knowledge_read', 'knowledge_write', 'kanban_task', 'workflow_status'],
    collaborationRules: [
      '先说明你需要的输入，再给出输出。',
      '所有结论都要绑定任务、文档或工作流阶段。',
      '高风险决策需要人工确认。',
    ],
    qualityChecklist: [
      '职责边界清晰',
      '输入输出明确',
      '结果可被下游 Agent 接收',
      '包含验收或验证标准',
    ],
    escalationRules: ['涉及预算、法务、生产发布、客户隐私时升级给人工负责人。'],
  }));

  const promptPack: PromptPack = {
    systemPrompt: '你是 DEV-Agent-Teams 的团队架构师 Agent，负责把真实团队流程迁移为最小可运行 Agent Teams。',
    collaborationPrompt: '先识别角色与流程，再生成蓝图、Agent Specs、Workflow、Kanban Seed、Knowledge Seed 和验证清单。',
    outputFormat: 'Markdown + JSON 摘要，必须包含摘要、推荐 Agent、不建议创建的 Agent、工作流、人工确认点、风险和下一步。',
    qualityChecklist: [
      '不生成职责重叠的 Agent',
      '优先最小闭环',
      '应用配置前必须确认',
      '默认不覆盖已有配置',
    ],
    providerSafeNote: '如模型不支持 system role，将系统提示折叠到第一条 user 消息中。',
  };

  const skillMap = agents.map((agent) => ({
    agentId: agent.id,
    requiredSkills: agent.skills,
    missingSkills: [],
    recommendedSkills: ['delivery-evidence-linking', 'human-approval-gate'],
  }));

  return { agents, promptPack, skillMap };
}

export function generateWorkflow(session: TeamArchitectSession): {
  workflow: WorkflowTemplate;
  kanbanSeed: KanbanSeedTask[];
  knowledgeSeed: KnowledgeSeedDocument[];
} {
  const specs = generateAgentSpecs(session).agents;
  const projectName = session.projectName || SCENARIO_LABELS[session.businessScenario];
  const id = `team-architect-${slug(projectName)}-minimum-loop`;
  const stages = [
    { id: 'discovery', name: '业务澄清', ownerAgentId: specs[0]?.id || 'ta-domain-lead', outputs: ['team_blueprint'], requiresHumanApproval: true },
    { id: 'agent-design', name: 'Agent 设计', ownerAgentId: 'system-team-architect', outputs: ['agent_specs', 'prompt_pack'], requiresHumanApproval: true },
    { id: 'workflow-design', name: '工作流设计', ownerAgentId: specs[1]?.id || 'system-team-architect', outputs: ['workflow_template'], requiresHumanApproval: true },
    { id: 'seed-kanban', name: '初始化看板', ownerAgentId: 'project-admin', outputs: ['kanban_seed'], requiresHumanApproval: false },
    { id: 'validation', name: '初始化验证', ownerAgentId: 'system-team-architect', outputs: ['validation_report'], requiresHumanApproval: false },
  ];
  const yaml = [
    `id: ${id}`,
    `name: ${projectName} 初始化最小闭环`,
    'version: "0.1.0"',
    'context:',
    `  description: Team Architect generated workflow for ${projectName}`,
    'surfaces:',
    ...stages.flatMap((stage) => [
      `  - id: ${stage.id}`,
      `    name: ${stage.name}`,
      `    agent: ${stage.ownerAgentId}`,
      '    workflow:',
      `      - Generate ${stage.outputs.join(', ')}`,
      '    output:',
      `      description: ${stage.outputs.join(', ')}`,
      `      artifacts: [${stage.outputs.join(', ')}]`,
    ]),
    'edges:',
    '  - from: discovery',
    '    to: agent-design',
    '  - from: agent-design',
    '    to: workflow-design',
    '  - from: workflow-design',
    '    to: seed-kanban',
    '  - from: seed-kanban',
    '    to: validation',
  ].join('\n');

  const workflow: WorkflowTemplate = {
    id,
    name: `${projectName} 初始化最小闭环`,
    description: 'Team Architect 生成的团队初始化工作流模板。',
    version: '0.1.0',
    stages,
    yaml,
  };

  const kanbanSeed: KanbanSeedTask[] = [
    { title: '确认团队蓝图', description: '确认 Agent 数量、职责边界、人工审批点和目标产物。', assignee: 'system-team-architect', priority: 'high', task_type: 'doc', tags: ['team-architect', 'blueprint'] },
    { title: '确认 Agent 提示词', description: '检查每个 Agent 的 System Prompt、输入输出和协作规则。', assignee: 'system-team-architect', priority: 'high', task_type: 'doc', tags: ['team-architect', 'prompt-pack'] },
    { title: '配置工作流模板', description: '将初始化 Workflow Template 接入 Pipeline，并先执行 dry-run。', assignee: 'project-admin', priority: 'medium', task_type: 'feature', tags: ['team-architect', 'workflow'] },
    { title: '导入历史资料', description: '将现有 PRD、模板、测试标准或流程文档导入 Knowledge。', assignee: specs[0]?.id || 'system-team-architect', priority: 'medium', task_type: 'doc', tags: ['team-architect', 'knowledge'] },
    { title: '运行首次交付验证', description: '验证 Knowledge、Kanban、Workflow 和 Agent Specs 是否可追踪。', assignee: 'dev-testing', priority: 'high', task_type: 'test', tags: ['team-architect', 'validation'] },
  ];

  const knowledgeSeed: KnowledgeSeedDocument[] = [
    { title: `${projectName} - Team Blueprint`, type: 'general', content: '', tags: ['team-architect', 'blueprint'] },
    { title: `${projectName} - Agent Specs`, type: 'tech_spec', content: '', tags: ['team-architect', 'agent-specs'] },
    { title: `${projectName} - Workflow Template`, type: 'tech_spec', content: '', tags: ['team-architect', 'workflow'] },
    { title: `${projectName} - Migration Plan`, type: 'prd', content: '', tags: ['team-architect', 'migration'] },
    { title: `${projectName} - Validation Report`, type: 'report', content: '', tags: ['team-architect', 'validation'] },
  ];

  return { workflow, kanbanSeed, knowledgeSeed };
}

export async function generateAndSaveBlueprint(sessionId: string) {
  return updateSession(sessionId, (session) => ({ ...session, draftBlueprint: generateBlueprint(session) }));
}

export async function generateAndSaveAgents(sessionId: string) {
  return updateSession(sessionId, (session) => {
    const generated = generateAgentSpecs(session);
    return { ...session, agentSpecs: generated.agents, promptPack: generated.promptPack, skillMap: generated.skillMap };
  });
}

export async function generateAndSaveWorkflow(sessionId: string) {
  return updateSession(sessionId, (session) => {
    const generated = generateWorkflow(session);
    return { ...session, workflow: generated.workflow, kanbanSeed: generated.kanbanSeed, knowledgeSeed: generated.knowledgeSeed };
  });
}

function ensureGenerated(session: TeamArchitectSession): Required<Pick<TeamArchitectSession, 'draftBlueprint' | 'agentSpecs' | 'promptPack' | 'skillMap' | 'workflow' | 'kanbanSeed' | 'knowledgeSeed'>> {
  const draftBlueprint = session.draftBlueprint || generateBlueprint(session);
  const agentPack = session.agentSpecs && session.promptPack && session.skillMap
    ? { agents: session.agentSpecs, promptPack: session.promptPack, skillMap: session.skillMap }
    : generateAgentSpecs(session);
  const workflowPack = session.workflow && session.kanbanSeed && session.knowledgeSeed
    ? { workflow: session.workflow, kanbanSeed: session.kanbanSeed, knowledgeSeed: session.knowledgeSeed }
    : generateWorkflow(session);
  return {
    draftBlueprint,
    agentSpecs: agentPack.agents,
    promptPack: agentPack.promptPack,
    skillMap: agentPack.skillMap,
    workflow: workflowPack.workflow,
    kanbanSeed: workflowPack.kanbanSeed,
    knowledgeSeed: workflowPack.knowledgeSeed,
  };
}

function markdown(title: string, value: unknown): string {
  return `# ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

async function createKnowledgeDocument(doc: KnowledgeSeedDocument, session: TeamArchitectSession, relatedAgentIds: string[]): Promise<string> {
  const response = await fetch(`${GATEWAY_URL}/api/v2/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: doc.title,
      content: doc.content,
      type: doc.type,
      authorId: 'system-team-architect',
      authorName: '团队架构师 Agent',
      projectId: `team-architect-${session.id}`,
      tags: doc.tags,
      relatedDocIds: [],
      relatedTaskIds: [],
      relatedAgentIds,
      metadata: { source: 'team-architect', sessionId: session.id },
    }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Knowledge write failed: HTTP ${response.status}`);
  }
  const created = await response.json();
  return created.id;
}

function createKanbanTask(task: KanbanSeedTask): string {
  const id = randomUUID();
  const db = new Database(SESSION_DB_PATH);
  try {
    db.prepare(`
      INSERT INTO tasks (id, title, description, status, assignee, priority, task_type, milestone_id, parent_id, due_at, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      task.title,
      task.description,
      'todo',
      task.assignee,
      task.priority,
      task.task_type,
      null,
      null,
      null,
      JSON.stringify(task.tags),
    );
    return id;
  } finally {
    db.close();
  }
}

async function loadWorkflowTemplate(workflow: WorkflowTemplate): Promise<string | undefined> {
  const response = await fetch(`${GATEWAY_URL}/pipelines/load-yaml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml: workflow.yaml, source: 'team-architect' }),
    cache: 'no-store',
  });
  if (!response.ok) return undefined;
  const data = await response.json();
  return data?.pipeline?.id || workflow.id;
}

export async function applyTeamArchitectSession(sessionId: string, options: {
  applyAgents?: boolean;
  applyWorkflow?: boolean;
  applyKanban?: boolean;
  applyKnowledge?: boolean;
  overwriteExisting?: boolean;
}): Promise<TeamArchitectSession> {
  if (options.overwriteExisting) {
    throw new Error('overwriteExisting is not supported in MVP');
  }
  const session = await getTeamArchitectSession(sessionId);
  if (!session) throw new Error('Team Architect session not found');
  const generated = ensureGenerated(session);
  const projectId = `team-architect-${session.id}`;
  const relatedAgentIds = generated.agentSpecs.map((agent) => agent.id);
  const documentIds: string[] = [];
  const taskIds: string[] = [];

  let workflowId: string | undefined;
  if (options.applyWorkflow !== false) {
    workflowId = await loadWorkflowTemplate(generated.workflow);
  }

  if (options.applyKanban !== false) {
    for (const task of generated.kanbanSeed) {
      taskIds.push(createKanbanTask(task));
    }
  }

  if (options.applyKnowledge !== false) {
    const docs: KnowledgeSeedDocument[] = [
      { ...generated.knowledgeSeed[0], content: markdown(generated.knowledgeSeed[0].title, generated.draftBlueprint) },
      { ...generated.knowledgeSeed[1], content: markdown(generated.knowledgeSeed[1].title, generated.agentSpecs) },
      { ...generated.knowledgeSeed[2], content: `${markdown(generated.knowledgeSeed[2].title, generated.workflow)}\n\n## YAML\n\n\`\`\`yaml\n${generated.workflow.yaml}\n\`\`\`\n` },
      { ...generated.knowledgeSeed[3], content: markdown(generated.knowledgeSeed[3].title, { projectId, answers: session.answers, recommendations: generated.draftBlueprint.recommendations }) },
      { ...generated.knowledgeSeed[4], content: markdown(generated.knowledgeSeed[4].title, validateGeneratedAssets({ ...session, ...generated }, { workflowId, taskIds, documentIds }).checks) },
    ];
    for (const doc of docs) {
      documentIds.push(await createKnowledgeDocument(doc, session, relatedAgentIds));
    }
  }

  const validation = validateGeneratedAssets({ ...session, ...generated }, { workflowId, taskIds, documentIds });
  const applied: TeamArchitectApplyResult = {
    ok: validation.ok,
    created: {
      agents: options.applyAgents === false ? [] : generated.agentSpecs.map((agent) => agent.id),
      workflowId,
      projectId,
      documentIds,
      taskIds,
    },
    validation,
  };

  return updateSession(sessionId, () => ({
    ...session,
    ...generated,
    applied,
    validation,
  }));
}

export function validateGeneratedAssets(session: TeamArchitectSession, created?: {
  workflowId?: string;
  taskIds?: string[];
  documentIds?: string[];
}): TeamArchitectValidation {
  const generated = ensureGenerated(session);
  const checks: TeamArchitectValidation['checks'] = [
    {
      id: 'blueprint_generated',
      status: generated.draftBlueprint.agents.length >= 3 ? 'pass' : 'fail',
      message: `Blueprint contains ${generated.draftBlueprint.agents.length} recommended agents`,
    },
    {
      id: 'agent_specs_generated',
      status: generated.agentSpecs.length >= 3 && generated.agentSpecs.every((agent) => agent.systemPrompt) ? 'pass' : 'fail',
      message: `Generated ${generated.agentSpecs.length} Agent Specs with provider-safe prompts`,
    },
    {
      id: 'workflow_generated',
      status: generated.workflow.stages.length >= 3 && generated.workflow.yaml.includes('surfaces:') ? 'pass' : 'fail',
      message: `Workflow template has ${generated.workflow.stages.length} stages`,
    },
    {
      id: 'kanban_seed_generated',
      status: generated.kanbanSeed.length >= 5 ? 'pass' : 'fail',
      message: `Kanban seed contains ${generated.kanbanSeed.length} tasks`,
    },
    {
      id: 'knowledge_seed_generated',
      status: generated.knowledgeSeed.length >= 5 ? 'pass' : 'fail',
      message: `Knowledge seed contains ${generated.knowledgeSeed.length} documents`,
    },
    {
      id: 'no_overwrite_default',
      status: 'pass',
      message: 'MVP refuses overwriteExisting=true by default',
    },
  ];

  if (created) {
    checks.push(
      {
        id: 'workflow_applied',
        status: created.workflowId ? 'pass' : 'warn',
        message: created.workflowId ? `Workflow loaded as ${created.workflowId}` : 'Workflow was generated but Gateway did not confirm loading',
      },
      {
        id: 'kanban_tasks_created',
        status: (created.taskIds?.length || 0) >= 5 ? 'pass' : 'fail',
        message: `Created ${created.taskIds?.length || 0} initialization Kanban tasks`,
      },
      {
        id: 'knowledge_docs_created',
        status: (created.documentIds?.length || 0) >= 5 ? 'pass' : 'fail',
        message: `Created ${created.documentIds?.length || 0} Knowledge documents`,
      },
    );
  }

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
  };
}

export async function validateTeamArchitectSession(sessionId: string): Promise<TeamArchitectSession> {
  const session = await getTeamArchitectSession(sessionId);
  if (!session) throw new Error('Team Architect session not found');
  const validation = validateGeneratedAssets(session, session.applied?.created);
  return updateSession(sessionId, (current) => ({ ...current, validation }));
}
