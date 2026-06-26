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
  'dev-frontend': {
    name: { zh: '前端开发 Agent', en: 'Frontend Agent' },
    label: { zh: '负责 UI、交互、前端工程化与用户体验交付', en: 'Owns UI, interaction, frontend engineering, and experience delivery' },
  },
  'dev-backend': {
    name: { zh: '后端开发 Agent', en: 'Backend Agent' },
    label: { zh: '负责 API、数据模型、服务集成与业务逻辑', en: 'Owns APIs, data models, service integration, and business logic' },
  },
  'dev-testing': {
    name: { zh: '测试质量 Agent', en: 'Testing Agent' },
    label: { zh: '负责测试计划、质量风险、回归与验收证据', en: 'Owns test plans, quality risks, regression, and acceptance evidence' },
  },
  'dev-devops': {
    name: { zh: 'DevOps Agent', en: 'DevOps Agent' },
    label: { zh: '负责部署、环境、CI/CD、发布与运维可靠性', en: 'Owns deployment, environments, CI/CD, release, and operational reliability' },
  },
  'dev-pm': {
    name: { zh: '产品经理 Agent', en: 'PM Agent' },
    label: { zh: '负责需求澄清、PRD、优先级与业务目标对齐', en: 'Owns requirement discovery, PRD, priority, and business alignment' },
  },
  'project-admin': {
    name: { zh: '项目管理员 Agent', en: 'Project Admin Agent' },
    label: { zh: '负责看板、里程碑、项目脉络与交付统筹', en: 'Owns kanban, milestones, project context, and delivery coordination' },
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
