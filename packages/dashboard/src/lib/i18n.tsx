'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'zh' | 'en';

type TranslationValue = string | Record<string, string>;

type TranslationDictionary = Record<string, TranslationValue>;

const STORAGE_KEY = 'open-agent-teams-locale';
const SETTINGS_KEY = 'open-agent-teams-settings';

export const dictionaries: Record<Locale, TranslationDictionary> = {
  zh: {
    'common.login': '登录',
    'common.register': '注册',
    'common.refresh': '刷新',
    'common.save': '保存',
    'common.reset': '重置',
    'common.cancel': '取消',
    'common.online': '在线',
    'common.offline': '离线',
    'nav.dashboard': '交付驾驶舱',
    'nav.teamArchitect': '团队架构师',
    'nav.kanban': '看板',
    'nav.pipeline': 'Pipeline',
    'nav.knowledge': '知识中心',
    'nav.agents': 'Agents',
    'nav.skills': 'Skills',
    'nav.chat': '协作会话',
    'nav.sessions': '历史会话',
    'nav.workflows': '工作流',
    'nav.settings': 'Settings',
    'nav.brandSubtitle': 'TEAM COORDINATION OS',
    'health.checking': '正在检查 Agent 状态',
    'health.agentsOnline': 'Agents 在线',
    'health.lastKnown': '最近可信状态',
    'health.noAgents': '未检测到在线 Agent',
    'hero.eyebrow': 'OPEN AGENT TEAMS COORDINATION FRAMEWORK',
    'hero.title': '让 AI Agent 不只会回答，而是能按团队方式交付。',
    'hero.subtitle': 'Open-Agent-Teams 是面向多领域 Agent Teams 的协作框架与通用控制台。它把会议、文档、看板、Pipeline、知识中心、Skills 与交付门禁接入同一条组织协作脉络，帮助不同领域团队快速孵化可落地的 Agent-Teams 产品。',
    'hero.primary': '启动团队协作',
    'hero.secondary': '查看协作看板',
    'hero.businessObject': '业务对象',
    'hero.deliveryLoop': '交付循环',
    'hero.agentTeam': 'Agent 团队',
    'hero.commercialEntry': '商业入口',
    'hero.commercialText': '私有部署 / 审计 / RAG 评审',
    'dashboard.readiness': '团队协同闭环',
    'dashboard.mvpReady': 'MVP 可用',
    'dashboard.needsAttention': '需要关注',
    'dashboard.checking': '检查中',
    'dashboard.loop': 'Team Coordination Loop',
    'dashboard.agentStatus': 'Agent 状态',
    'dashboard.quickActions': '快捷动作',
    'dashboard.systemInfo': '系统信息',
    'dashboard.activeAgents': '活跃 Agent',
    'dashboard.totalSkills': '总技能数',
    'dashboard.successRate': '成功率',
    'dashboard.system': '系统',
    'dashboard.viewAll': '查看全部',
    'dashboard.openChat': '打开会话',
    'settings.title': '设置',
    'settings.subtitle': '配置 Agent 团队系统',
    'settings.modelConfig': '模型配置',
    'settings.agentConfig': 'Agent 配置',
    'settings.languageConfig': '语言与本地化',
    'settings.language': '界面语言',
    'settings.languageHint': 'Dashboard 与支持的 API 会按该语言展示中英文内容。',
    'settings.modelProvider': '模型供应商',
    'settings.modelName': '模型名称',
    'settings.apiEndpoint': 'API Endpoint',
    'settings.maxTokens': '最大 Tokens',
    'settings.temperature': 'Temperature',
    'settings.precise': '精确',
    'settings.creative': '创造',
    'settings.autoRoute': '自动路由到 Agent',
    'settings.logLevel': '日志级别',
    'settings.resetDefaults': '恢复默认',
    'settings.saveSettings': '保存设置',
    'settings.saved': '设置已保存',
    'settings.resetConfirm': '确定要恢复默认设置吗？',
    'settings.resetDone': '已恢复默认设置',
  },
  en: {
    'common.login': 'Log in',
    'common.register': 'Register',
    'common.refresh': 'Refresh',
    'common.save': 'Save',
    'common.reset': 'Reset',
    'common.cancel': 'Cancel',
    'common.online': 'Online',
    'common.offline': 'Offline',
    'nav.dashboard': 'Dashboard',
    'nav.teamArchitect': 'Team Architect',
    'nav.kanban': 'Kanban',
    'nav.pipeline': 'Pipeline',
    'nav.knowledge': 'Knowledge',
    'nav.agents': 'Agents',
    'nav.skills': 'Skills',
    'nav.chat': 'Chat',
    'nav.sessions': 'Sessions',
    'nav.workflows': 'Workflows',
    'nav.settings': 'Settings',
    'nav.brandSubtitle': 'TEAM COORDINATION OS',
    'health.checking': 'Checking agents...',
    'health.agentsOnline': 'Agents Online',
    'health.lastKnown': 'Last known',
    'health.noAgents': 'No agents online',
    'hero.eyebrow': 'OPEN AGENT TEAMS COORDINATION FRAMEWORK',
    'hero.title': 'Make AI Agents deliver as teams, not just answer questions.',
    'hero.subtitle': 'Open-Agent-Teams is a coordination framework and reusable console for multi-domain Agent Teams. It connects meetings, documents, kanban, pipelines, knowledge, skills, and delivery gates into one organizational collaboration loop for building production Agent-Teams products.',
    'hero.primary': 'Start coordination',
    'hero.secondary': 'Open kanban',
    'hero.businessObject': 'Business Object',
    'hero.deliveryLoop': 'Delivery Loop',
    'hero.agentTeam': 'Agent Team',
    'hero.commercialEntry': 'Commercial Entry',
    'hero.commercialText': 'Private Deploy / Audit / RAG Review',
    'dashboard.readiness': 'Team Coordination Loop',
    'dashboard.mvpReady': 'MVP Ready',
    'dashboard.needsAttention': 'Needs Attention',
    'dashboard.checking': 'Checking',
    'dashboard.loop': 'Team Coordination Loop',
    'dashboard.agentStatus': 'Agent Status',
    'dashboard.quickActions': 'Quick Actions',
    'dashboard.systemInfo': 'System Info',
    'dashboard.activeAgents': 'Active Agents',
    'dashboard.totalSkills': 'Total Skills',
    'dashboard.successRate': 'Success Rate',
    'dashboard.system': 'System',
    'dashboard.viewAll': 'View All',
    'dashboard.openChat': 'Open Chat',
    'settings.title': 'Settings',
    'settings.subtitle': 'Configure your agent team system',
    'settings.modelConfig': 'Model Configuration',
    'settings.agentConfig': 'Agent Configuration',
    'settings.languageConfig': 'Language & Localization',
    'settings.language': 'Interface Language',
    'settings.languageHint': 'Dashboard and supported APIs render bilingual content according to this language.',
    'settings.modelProvider': 'Model Provider',
    'settings.modelName': 'Model Name',
    'settings.apiEndpoint': 'API Endpoint',
    'settings.maxTokens': 'Max Tokens',
    'settings.temperature': 'Temperature',
    'settings.precise': 'Precise',
    'settings.creative': 'Creative',
    'settings.autoRoute': 'Auto-route to Agents',
    'settings.logLevel': 'Log Level',
    'settings.resetDefaults': 'Reset to Defaults',
    'settings.saveSettings': 'Save Settings',
    'settings.saved': 'Settings saved successfully',
    'settings.resetConfirm': 'Reset all settings to defaults?',
    'settings.resetDone': 'Settings reset to defaults',
  },
};

export function normalizeLocale(value?: string | null): Locale {
  if (!value) return 'zh';
  const normalized = value.toLowerCase();
  return normalized === 'en' || normalized.startsWith('en-') ? 'en' : 'zh';
}

function loadInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  try {
    const storedLocale = localStorage.getItem(STORAGE_KEY);
    if (storedLocale) return normalizeLocale(storedLocale);
    const storedSettings = localStorage.getItem(SETTINGS_KEY);
    if (storedSettings) {
      const parsed = JSON.parse(storedSettings);
      if (parsed?.language) return normalizeLocale(parsed.language);
    }
    return normalizeLocale(window.navigator.language);
  } catch {
    return 'zh';
  }
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
  apiHeaders: HeadersInit;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh');

  useEffect(() => {
    const initial = loadInitialLocale();
    setLocaleState(initial);
    document.documentElement.lang = initial === 'zh' ? 'zh-CN' : 'en';
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, nextLocale);
      document.documentElement.lang = nextLocale === 'zh' ? 'zh-CN' : 'en';
    }
  }, []);

  const t = useCallback((key: string, fallback?: string) => {
    const value = dictionaries[locale]?.[key];
    return typeof value === 'string' ? value : fallback || key;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t,
    apiHeaders: { 'Accept-Language': locale === 'zh' ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9' },
  }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
