export const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', labelKey: 'nav.dashboard', icon: '📊' },
  { href: '/kanban', label: '看板', labelKey: 'nav.kanban', icon: '📋' },
  { href: '/pipeline', label: 'Pipeline', labelKey: 'nav.pipeline', icon: '🚀' },
  { href: '/knowledge', label: '知识中心', labelKey: 'nav.knowledge', icon: '🧠' },
  { href: '/agents', label: 'Agents', labelKey: 'nav.agents', icon: '🤖' },
  { href: '/skills', label: 'Skills', labelKey: 'nav.skills', icon: '📚' },
  { href: '/chat', label: 'Chat', labelKey: 'nav.chat', icon: '💬' },
  { href: '/sessions', label: 'Sessions', labelKey: 'nav.sessions', icon: '💬' },
  { href: '/workflows', label: 'Workflows', labelKey: 'nav.workflows', icon: '🔄' },
  { href: '/settings', label: 'Settings', labelKey: 'nav.settings', icon: '⚙️' },
] as const;

export const DEFAULT_SETTINGS = {
  modelProvider: 'deepseek',
  modelName: 'deepseek-v4-pro[1m]',
  apiEndpoint: 'https://api.deepseek.com/anthropic',
  maxTokens: 2000,
  temperature: 0.7,
  autoRoute: true,
  logLevel: 'info',
  language: 'zh',
} as const;

export const SKILL_CATEGORIES = [
  { key: 'frontend', label: 'Frontend', icon: '🎨' },
  { key: 'backend', label: 'Backend', icon: '⚙️' },
  { key: 'testing', label: 'Testing', icon: '🧪' },
  { key: 'devops', label: 'DevOps', icon: '🚀' },
  { key: 'database', label: 'Database', icon: '🗄️' },
  { key: 'security', label: 'Security', icon: '🔒' },
  { key: 'pm', label: 'PM', icon: '📋' },
] as const;
