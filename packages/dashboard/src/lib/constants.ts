export const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/agents', label: 'Agents', icon: '🤖' },
  { href: '/skills', label: 'Skills', icon: '📚' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/sessions', label: 'Sessions', icon: '💬' },
  { href: '/workflows', label: 'Workflows', icon: '🔄' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
] as const;

export const DEFAULT_SETTINGS = {
  modelProvider: 'deepseek',
  modelName: 'deepseek-v4-pro[1m]',
  apiEndpoint: 'https://api.deepseek.com/anthropic',
  maxTokens: 2000,
  temperature: 0.7,
  autoRoute: true,
  logLevel: 'info',
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
