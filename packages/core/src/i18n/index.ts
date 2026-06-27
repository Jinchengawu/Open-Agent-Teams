export type Locale = 'zh' | 'en';

const SUPPORTED_LOCALES: Locale[] = ['zh', 'en'];

export function normalizeLocale(value?: string | null): Locale {
  if (!value) return 'zh';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('cn')) return 'zh';
  return 'zh';
}

export function isSupportedLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export function negotiateLocale(input: {
  queryLang?: string | null;
  acceptLanguage?: string | string[] | null;
  fallback?: Locale;
}): Locale {
  if (input.queryLang) return normalizeLocale(input.queryLang);
  const header = Array.isArray(input.acceptLanguage)
    ? input.acceptLanguage.join(',')
    : input.acceptLanguage;
  if (!header) return input.fallback || 'zh';
  const first = header.split(',')[0]?.trim();
  return normalizeLocale(first || input.fallback || 'zh');
}

export type LocalizedText = {
  zh: string;
  en: string;
};

export function pickText(text: LocalizedText, locale: Locale): string {
  return text[locale] || text.zh;
}

const AGENT_TEXT: Record<string, { name: LocalizedText; label: LocalizedText }> = {
  'intent-router': {
    name: { zh: '意图路由 Agent', en: 'Intent Router' },
    label: { zh: '负责意图识别、复杂度判断与协作模式选择', en: 'Owns intent classification, complexity assessment, and coordination mode selection' },
  },
  'team-orchestrator': {
    name: { zh: '团队编排 Agent', en: 'Team Orchestrator' },
    label: { zh: '负责任务规划、角色分工、状态治理与交接协调', en: 'Owns task planning, role assignment, state governance, and handoff coordination' },
  },
  'workflow-conductor': {
    name: { zh: '工作流执行 Agent', en: 'Workflow Conductor' },
    label: { zh: '负责工作流面执行、依赖处理、产物生成与阻塞反馈', en: 'Owns workflow surface execution, dependency handling, artifact production, and blocker feedback' },
  },
  'knowledge-steward': {
    name: { zh: '知识管家 Agent', en: 'Knowledge Steward' },
    label: { zh: '负责文档、知识索引、追踪关系与组织记忆', en: 'Owns documents, knowledge indexing, traceability, and organizational memory' },
  },
  'recovery-agent': {
    name: { zh: '恢复自检 Agent', en: 'Recovery Agent' },
    label: { zh: '负责质量审查、失败分析、风险识别与恢复计划', en: 'Owns quality review, failure analysis, risk assessment, and recovery planning' },
  },
  'integration-agent': {
    name: { zh: '集成交付 Agent', en: 'Integration Agent' },
    label: { zh: '负责最终交接、集成就绪、经验沉淀与后续任务', en: 'Owns final handoff, integration readiness, experience capture, and follow-up work' },
  },
};

export function localizeAgent<T extends Record<string, any>>(agent: T, locale: Locale): T & {
  displayName: string;
  displayLabel: string;
  locale: Locale;
  translations?: {
    name: LocalizedText;
    label: LocalizedText;
  };
} {
  const id = String(agent.id || agent.name || '');
  const text = AGENT_TEXT[id];
  if (!text) {
    return {
      ...agent,
      displayName: String(agent.name || agent.id || ''),
      displayLabel: String(agent.label || agent.name || agent.id || ''),
      locale,
    };
  }
  return {
    ...agent,
    displayName: pickText(text.name, locale),
    displayLabel: pickText(text.label, locale),
    locale,
    translations: text,
  };
}

export function localizeAgents<T extends Record<string, any>>(agents: T[], locale: Locale) {
  return agents.map((agent) => localizeAgent(agent, locale));
}
