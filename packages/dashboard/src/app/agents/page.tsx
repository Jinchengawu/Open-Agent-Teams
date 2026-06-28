'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useAgentHealth } from '@/hooks/useAgentHealth'
import { useSettings } from '@/hooks/useSettings'
import type { AgentStatus, ModelProfile } from '@/lib/types'

// ============================================================================
// Agent 个性配置（拟人化数据）
// ============================================================================

interface AgentPersonality {
  avatar: string       // 虚拟形象 emoji
  accentColor: string  // 主色调
  greeting: string     // 问候语
  signature: string    // 个性签名
  mood: string         // 当前心情
  roleDescription: string
  specialties: string[]
  catchphrase: string
}

interface CustomAgentView {
  id: string
  name: string
  role: string
  description: string
  endpoint?: string
  modelId?: string
  modelConfig?: {
    provider: string
    model: string
    baseUrl: string
    apiKey?: string
  }
  skills: string[]
  tags: string[]
  systemPrompt?: string
  hermes?: {
    homeDir: string
    port?: number
    timeoutMs: number
    configPath: string
    source: 'dashboard'
  }
  runtime?: {
    status: 'stopped' | 'starting' | 'running' | 'error'
    pid?: number
    port?: number
    endpoint?: string
    startedAt?: string
    stoppedAt?: string
    error?: string
  }
  createdAt: string
  updatedAt: string
}

interface CustomAgentForm {
  name: string
  role: string
  description: string
  skills: string
  systemPrompt: string
  modelId: string
}

const EMPTY_CUSTOM_AGENT_FORM: CustomAgentForm = {
  name: '',
  role: '',
  description: '',
  skills: '',
  systemPrompt: '',
  modelId: '',
}

const AGENT_PERSONALITIES: Record<string, AgentPersonality> = {
  'dev-frontend': {
    avatar: '👨‍💻',
    accentColor: 'from-blue-400 to-cyan-400',
    greeting: 'Hi! 我是 Frontend，有什么界面需求吗？',
    signature: '代码如诗，界面如画',
    mood: '充满灵感 ✨',
    roleDescription: '前端开发专家，专注 React/Vue/TypeScript',
    specialties: ['React', 'Vue', 'TypeScript', 'CSS3', 'Tailwind'],
    catchphrase: '交给我，界面绝对美！',
  },
  'dev-backend': {
    avatar: '👨‍🔧',
    accentColor: 'from-green-400 to-emerald-400',
    greeting: '后端交给我，API 稳如泰山！',
    signature: '数据在手，天下我有',
    mood: '冷静分析 🧠',
    roleDescription: '后端开发专家，专注 Node.js/Python/Go',
    specialties: ['Node.js', 'Python', 'Go', 'PostgreSQL', 'Redis'],
    catchphrase: '接口已经 ready 了！',
  },
  'dev-testing': {
    avatar: '👩‍🔬',
    accentColor: 'from-purple-400 to-pink-400',
    greeting: 'Bug 无所遁形！我来测试！',
    signature: '找不到 bug 算我输',
    mood: '虎视眈眈 👀',
    roleDescription: '测试专家，擅长 pytest/Jest/Playwright',
    specialties: ['pytest', 'Jest', 'Playwright', 'E2E', '覆盖率'],
    catchphrase: '这个 case 我早测过了！',
  },
  'dev-devops': {
    avatar: '👨‍🚀',
    accentColor: 'from-orange-400 to-red-400',
    greeting: '基础设施已就绪，随时部署！',
    signature: 'DevOps 之道，自动化为王',
    mood: '火力全开 🔥',
    roleDescription: 'DevOps 专家，负责 CI/CD/监控/部署',
    specialties: ['Docker', 'K8s', 'CI/CD', 'Terraform', 'Prometheus'],
    catchphrase: '一键部署，秒级上线！',
  },
  'dev-pm': {
    avatar: '👩‍💼',
    accentColor: 'from-amber-400 to-yellow-400',
    greeting: '来聊聊产品需求吧！',
    signature: '以用户为中心，数据驱动决策',
    mood: '热情满满 💡',
    roleDescription: '产品经理，负责 PRD/需求分析/用户故事',
    specialties: ['PRD', '用户故事', '竞品分析', '数据埋点', 'A/B 测试'],
    catchphrase: '这个需求我懂！',
  },
  'project-admin': {
    avatar: '🤖',
    accentColor: 'from-indigo-400 to-violet-400',
    greeting: '项目进度一切正常，需要协调吗？',
    signature: '运筹帷幄，决胜千里',
    mood: '运筹帷幄 🎯',
    roleDescription: '项目管理员，负责看板/里程碑/进度追踪',
    specialties: ['看板管理', '里程碑', '进度追踪', '风险管理', '周报'],
    catchphrase: 'Deadline 就是生产力！',
  },
}

async function fetchCustomAgents(): Promise<CustomAgentView[]> {
  const res = await fetch('/api/agents/custom', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load custom agents')
  const data = await res.json() as { agents?: CustomAgentView[] }
  return data.agents || []
}

// 状态映射
function getAgentMood(agent: AgentStatus): { label: string; emoji: string; color: string } {
  if (!agent.online) return { label: '离线', emoji: '💤', color: 'bg-gray-200 text-gray-500' }
  // 随机但稳定的心情（基于 id 哈希）
  const hash = agent.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const moods = [
    { label: '精力充沛', emoji: '⚡', color: 'bg-yellow-100 text-yellow-700' },
    { label: '专注工作', emoji: '🎯', color: 'bg-blue-100 text-blue-700' },
    { label: '乐于助人', emoji: '🤝', color: 'bg-green-100 text-green-700' },
    { label: '思考中', emoji: '🤔', color: 'bg-purple-100 text-purple-700' },
  ]
  return moods[hash % moods.length]
}

// ============================================================================
// 虚拟形象组件（CSS 绘制）
// ============================================================================

function AgentAvatar({ personality, isOnline, size = 'lg' }: { personality: AgentPersonality; isOnline: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-12 h-12 text-xl',
    md: 'w-16 h-16 text-2xl',
    lg: 'w-24 h-24 text-4xl',
  }

  return (
    <div className="relative group">
      {/* 光晕背景 */}
      <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${personality.accentColor} opacity-20 blur-md group-hover:opacity-40 transition-opacity duration-500`} />
      {/* 头像容器 */}
      <div className={`relative ${sizeClasses[size]} rounded-full bg-gradient-to-br from-white to-gray-50 shadow-lg border-2 border-white flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
        <span className="drop-shadow-sm">{personality.avatar}</span>
      </div>
      {/* 在线状态指示器 */}
      {isOnline && (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse" />
      )}
    </div>
  )
}

// ============================================================================
// 交互面板（点击 Agent 后打开）
// ============================================================================

function AgentInteractionPanel({
  agent,
  onClose,
  onChat,
  onViewTasks,
  onViewDocs,
}: {
  agent: AgentStatus
  onClose: () => void
  onChat: () => void
  onViewTasks: () => void
  onViewDocs: () => void
}) {
  const personality = AGENT_PERSONALITIES[agent.id] || {
    avatar: '🤖',
    accentColor: 'from-gray-400 to-gray-500',
    greeting: '你好！',
    signature: '随时待命',
    mood: '工作中',
    roleDescription: agent.label,
    specialties: agent.tags,
    catchphrase: '收到！',
  }
  const mood = getAgentMood(agent)
  const { showToast } = useToast()

  // 真实数据：从 API 获取任务统计
  const [taskStats, setTaskStats] = useState({ total: 0, inProgress: 0, completed: 0, pending: 0 })
  const [taskStatsLoading, setTaskStatsLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v2/agents/${agent.id}/tasks`)
      .then(r => r.json())
      .then((data: { tasks: Array<{ status: string }> }) => {
        const tasks = data.tasks || []
        const inProgress = tasks.filter(t => t.status === 'in_progress').length
        const completed = tasks.filter(t => t.status === 'done').length
        const pending = tasks.filter(t => t.status === 'todo' || t.status === 'blocked').length
        setTaskStats({
          total: tasks.length,
          inProgress,
          completed,
          pending,
        })
      })
      .catch(() => setTaskStats({ total: 0, inProgress: 0, completed: 0, pending: 0 }))
      .finally(() => setTaskStatsLoading(false))
  }, [agent.id])

  // 真实数据：从 API 获取最近活动
  const [activities, setActivities] = useState<Array<{
    action: string
    time: string
    type: 'document' | 'comment' | 'task' | 'meeting' | 'code'
    details?: string
  }>>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v2/agents/${agent.id}/activities?limit=5`)
      .then(r => r.json())
      .then((data: { activities: Array<{ action: string; time: string; type: any; details?: string }> }) => {
        setActivities(data.activities || [])
      })
      .catch(() => setActivities([]))
      .finally(() => setActivitiesLoading(false))
  }, [agent.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* 面板 */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden animate-in fade-in zoom-in duration-300">
        {/* 顶部渐变背景 */}
        <div className={`h-32 bg-gradient-to-br ${personality.accentColor} relative overflow-hidden`}>
          <div className="absolute inset-0 bg-white/10" />
          {/* 装饰圆 */}
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/20 rounded-full" />
          <div className="absolute -bottom-5 -left-5 w-20 h-20 bg-white/20 rounded-full" />
          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition"
          >
            ✕
          </button>
        </div>

        {/* 头像（悬浮在渐变背景上） */}
        <div className="relative -mt-12 px-6 flex items-end">
          <div className="relative">
            <AgentAvatar personality={personality} isOnline={agent.online} size="lg" />
          </div>
          <div className="ml-4 mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">{agent.name}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${mood.color}`}>
                {mood.emoji} {mood.label}
              </span>
            </div>
            <p className="text-sm text-gray-500">{personality.roleDescription}</p>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="p-6 overflow-y-auto max-h-[calc(85vh-180px)]">
          {/* 个性签名 */}
          <div className="bg-gray-50 rounded-xl p-4 mb-5">
            <p className="text-sm text-gray-600 italic">"{personality.signature}"</p>
            <p className="text-xs text-gray-400 mt-1">{personality.greeting}</p>
          </div>

          {/* 专长标签 */}
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">🎨 专长领域</h3>
            <div className="flex flex-wrap gap-2">
              {personality.specialties.map((s) => (
                <span
                  key={s}
                  className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${personality.accentColor} text-white shadow-sm`}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* 任务状态看板 */}
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">📊 任务状态</h3>
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-blue-600">{taskStatsLoading ? '…' : taskStats.total}</p>
                <p className="text-xs text-gray-500">总任务</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-amber-600">{taskStatsLoading ? '…' : taskStats.inProgress}</p>
                <p className="text-xs text-gray-500">进行中</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-green-600">{taskStatsLoading ? '…' : taskStats.completed}</p>
                <p className="text-xs text-gray-500">已完成</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-gray-600">{taskStatsLoading ? '…' : taskStats.pending}</p>
                <p className="text-xs text-gray-500">待处理</p>
              </div>
            </div>
          </div>

          {/* 最近活动 */}
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">📝 最近动态</h3>
            {activitiesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-2 h-10 animate-pulse" />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">暂无活动记录</p>
            ) : (
              <div className="space-y-2">
                {activities.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg p-2">
                    <span className="text-lg">
                      {a.type === 'document' ? '📄' : a.type === 'meeting' ? '🎙️' : a.type === 'comment' ? '💬' : a.type === 'task' ? '✅' : '💻'}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium">{a.action}</p>
                      <p className="text-xs text-gray-400">{a.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 快速操作 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">🚀 快速操作</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className={`w-full bg-gradient-to-r ${personality.accentColor} text-white hover:opacity-90 transition`}
                onClick={onChat}
              >
                💬 开始对话
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={onViewTasks}
              >
                📋 查看任务
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={onViewDocs}
              >
                📚 查看文档
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  navigator.clipboard?.writeText(personality.catchphrase)
                  showToast('口头禅已复制！', 'success')
                }}
              >
                🎤 {personality.catchphrase.substring(0, 6)}...
              </Button>
            </div>
          </div>

          {/* 系统信息 */}
          <div className="mt-5 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Port: {agent.port}</span>
              <span>Skills: {agent.skillCount}</span>
              <span>Tags: {agent.tags.join(', ')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 角色卡片组件
// ============================================================================

function AgentCharacterCard({
  agent,
  isSelected,
  onClick,
  modelProfiles,
  selectedModelId,
  onModelChange,
}: {
  agent: AgentStatus
  isSelected: boolean
  onClick: () => void
  modelProfiles: ModelProfile[]
  selectedModelId: string
  onModelChange: (modelId: string) => void
}) {
  const personality = AGENT_PERSONALITIES[agent.id] || {
    avatar: '🤖',
    accentColor: 'from-gray-400 to-gray-500',
    greeting: '你好！',
    signature: '随时待命',
    mood: '工作中',
    roleDescription: agent.label,
    specialties: agent.tags,
    catchphrase: '收到！',
  }
  const mood = getAgentMood(agent)

  return (
    <div
      className={`group relative cursor-pointer transition-all duration-300 ${
        isSelected ? 'scale-[1.02]' : 'hover:scale-[1.02]'
      }`}
      onClick={onClick}
    >
      <Card className={`overflow-hidden border-2 transition-all duration-300 ${
        isSelected
          ? 'border-blue-400 shadow-xl shadow-blue-100'
          : 'border-transparent hover:border-gray-200 hover:shadow-lg'
      }`}>
        <CardContent className="p-0">
          {/* 顶部渐变色条 */}
          <div className={`h-2 bg-gradient-to-r ${personality.accentColor}`} />

          <div className="p-5">
            <div className="flex items-start gap-4">
              {/* 虚拟形象 */}
              <div className="flex-shrink-0">
                <AgentAvatar personality={personality} isOnline={agent.online} size="md" />
              </div>

              {/* 信息区 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-gray-900">{agent.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${mood.color}`}>
                    {mood.emoji} {mood.label}
                  </span>
                </div>

                <p className="text-sm text-gray-500 mb-2">{personality.roleDescription}</p>

                {/* 个性签名 */}
                <p className="text-xs text-gray-400 italic mb-3">"{personality.signature}"</p>

                {/* 专长标签 */}
                <div className="flex flex-wrap gap-1.5">
                  {personality.specialties.slice(0, 3).map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600"
                    >
                      {s}
                    </span>
                  ))}
                  {personality.specialties.length > 3 && (
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-400">
                      +{personality.specialties.length - 3}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 底部状态栏 */}
            <div className="mt-4 pt-3 border-t border-gray-100 space-y-3">
              <label className="block" onClick={(event) => event.stopPropagation()}>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                  模型
                </span>
                <select
                  value={selectedModelId}
                  onChange={(event) => onModelChange(event.target.value)}
                  className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-cyan-500"
                >
                  {modelProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name || profile.modelName || profile.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>📊 {agent.skillCount} 技能</span>
                <span>🔌 Port {agent.port}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${agent.online ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`} />
                <span className="text-xs text-gray-400">
                  {agent.online ? '在线' : '离线'}
                </span>
              </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function CustomAgentCard({
  agent,
  modelProfiles,
  selectedModelId,
  onModelChange,
  onStart,
  onStop,
  onDelete,
}: {
  agent: CustomAgentView
  modelProfiles: ModelProfile[]
  selectedModelId: string
  onModelChange: (modelId: string) => void
  onStart: () => void
  onStop: () => void
  onDelete: () => void
}) {
  const isRunning = agent.runtime?.status === 'running'

  return (
    <Card className="overflow-hidden border border-dashed border-gray-300 bg-white/85 shadow-sm">
      <CardContent className="p-0">
        <div className="h-2 bg-gradient-to-r from-gray-700 via-cyan-500 to-orange-500" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-gray-900 truncate">{agent.name}</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  Hermes Profile
                </span>
              </div>
              <p className="text-sm font-medium text-gray-600">{agent.role}</p>
              <p className="text-xs text-gray-500 mt-2 line-clamp-2">{agent.description}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-red-200 text-red-600 hover:bg-red-50"
              onClick={onDelete}
            >
              删除
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {agent.skills.length === 0 ? (
              <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-400">未配置 skills</span>
            ) : (
              agent.skills.slice(0, 5).map((skill) => (
                <span key={skill} className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                  {skill}
                </span>
              ))
            )}
            {agent.skills.length > 5 && (
              <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-400">
                +{agent.skills.length - 5}
              </span>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>
              {agent.hermes?.port ? `Hermes :${agent.hermes.port}` : 'Hermes profile pending'}
              {agent.hermes?.homeDir ? ` · ${agent.hermes.homeDir}` : ''}
            </span>
            <span className={isRunning ? 'text-green-600' : 'text-gray-400'}>
              {isRunning ? `Running${agent.runtime?.pid ? ` #${agent.runtime.pid}` : ''}` : 'Stopped'}
            </span>
          </div>

          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
              运行模型
            </span>
            <select
              value={selectedModelId}
              onChange={(event) => onModelChange(event.target.value)}
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-xs text-gray-700 outline-none focus:border-cyan-500"
            >
              {modelProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name || profile.modelName || profile.id}
                </option>
              ))}
            </select>
            {isRunning && (
              <span className="mt-1 block text-[11px] text-amber-600">
                切换后需要重启实例才会应用到 Hermes。
              </span>
            )}
          </label>

          <div className="mt-4 flex justify-end gap-2">
            {isRunning ? (
              <Button variant="outline" size="sm" onClick={onStop}>
                停止实例
              </Button>
            ) : (
              <Button size="sm" onClick={onStart}>
                启动实例
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// 主页面
// ============================================================================

export default function AgentsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { agents, isLoading, error, mutate } = useAgentHealth()
  const { settings, updateSettings, isLoaded: settingsLoaded } = useSettings()
  const [selectedAgent, setSelectedAgent] = useState<AgentStatus | null>(null)
  const [customAgents, setCustomAgents] = useState<CustomAgentView[]>([])
  const [customAgentsLoading, setCustomAgentsLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [customAgentForm, setCustomAgentForm] = useState<CustomAgentForm>(EMPTY_CUSTOM_AGENT_FORM)
  const [isSavingCustomAgent, setIsSavingCustomAgent] = useState(false)

  const modelProfiles = settings.modelProfiles.length > 0 ? settings.modelProfiles : []
  const defaultModelId = settings.defaultModelProfileId || modelProfiles[0]?.id || ''
  const getAgentModelId = (agentId: string, fallback?: string) =>
    settings.agentModelAssignments?.[agentId] || fallback || defaultModelId
  const modelPayloadById = (modelId: string) => {
    const profile = modelProfiles.find((item) => item.id === modelId) || modelProfiles[0]
    if (!profile) return null
    return {
      provider: profile.provider,
      model: profile.modelName,
      baseUrl: profile.apiEndpoint,
      apiKey: profile.apiKey || '',
    }
  }

  function assignBuiltinAgentModel(agentId: string, modelId: string) {
    updateSettings({
      ...settings,
      agentModelAssignments: {
        ...(settings.agentModelAssignments || {}),
        [agentId]: modelId,
      },
    })
    showToast('Agent 模型配置已保存', 'success')
  }

  async function assignCustomAgentModel(agent: CustomAgentView, modelId: string) {
    const modelConfig = modelPayloadById(modelId)
    if (!modelConfig) {
      showToast('请先在 Settings 中配置模型', 'error')
      return
    }
    try {
      const res = await fetch(`/api/agents/custom/${encodeURIComponent(agent.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-model',
          modelId,
          modelConfig,
        }),
      })
      const data = await res.json() as { agent?: CustomAgentView; error?: string }
      if (!res.ok || !data.agent) throw new Error(data.error || '模型切换失败')
      setCustomAgents((current) => current.map((item) => item.id === agent.id ? data.agent! : item))
      updateSettings({
        ...settings,
        agentModelAssignments: {
          ...(settings.agentModelAssignments || {}),
          [agent.id]: modelId,
        },
      })
      showToast(agent.runtime?.status === 'running' ? '模型已保存，重启 Agent 后生效' : 'Agent 模型已切换', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '模型切换失败', 'error')
    }
  }

  // 欢迎语动画
  const [greeting, setGreeting] = useState('')
  useEffect(() => {
    const greetings = [
      '欢迎来到 Agent 团队！👋',
      '你的专属开发团队已就绪！🚀',
      '6 位 Agent 随时待命！💪',
      '点击任意 Agent 开始交互！🎯',
    ]
    const idx = Math.floor(Math.random() * greetings.length)
    setGreeting(greetings[idx])
  }, [])

  useEffect(() => {
    fetchCustomAgents()
      .then(setCustomAgents)
      .catch(() => showToast('自定义 Agent 加载失败', 'error'))
      .finally(() => setCustomAgentsLoading(false))
  }, [showToast])

  async function handleCreateCustomAgent() {
    if (!customAgentForm.name.trim() || !customAgentForm.role.trim()) {
      showToast('请填写 Agent 名称和角色', 'info')
      return
    }
    const modelId = customAgentForm.modelId || defaultModelId
    const modelConfig = modelPayloadById(modelId)

    setIsSavingCustomAgent(true)
    try {
      const res = await fetch('/api/agents/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...customAgentForm,
          modelId,
          modelConfig,
        }),
      })
      const data = await res.json() as { agent?: CustomAgentView; error?: string }
      if (!res.ok || !data.agent) throw new Error(data.error || '创建失败')
      setCustomAgents((current) => [data.agent!, ...current])
      setCustomAgentForm(EMPTY_CUSTOM_AGENT_FORM)
      setShowCreateForm(false)
      showToast('自定义 Agent 已添加', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '自定义 Agent 创建失败', 'error')
    } finally {
      setIsSavingCustomAgent(false)
    }
  }

  async function handleDeleteCustomAgent(agent: CustomAgentView) {
    const confirmed = await confirm({
      title: '删除自定义 Agent？',
      description: `将删除「${agent.name}」的注册信息，并从会议、流水线可选 Agent 池中移除。正在运行的实例也会失去管理入口。`,
      confirmLabel: '删除 Agent',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/agents/custom/${encodeURIComponent(agent.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('删除失败')
      setCustomAgents((current) => current.filter((item) => item.id !== agent.id))
      showToast('自定义 Agent 已删除', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '自定义 Agent 删除失败', 'error')
    }
  }

  async function handleStartCustomAgent(agent: CustomAgentView) {
    try {
      const res = await fetch(`/api/agents/custom/${encodeURIComponent(agent.id)}/start`, { method: 'POST' })
      const data = await res.json() as { agent?: CustomAgentView; error?: string }
      if (!res.ok || !data.agent) throw new Error(data.error || '启动失败')
      setCustomAgents((current) => current.map((item) => item.id === agent.id ? data.agent! : item))
      showToast('自定义 Agent 实例已启动', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '自定义 Agent 启动失败', 'error')
    }
  }

  async function handleStopCustomAgent(agent: CustomAgentView) {
    const confirmed = await confirm({
      title: '停止 Agent 实例？',
      description: `将停止「${agent.name}」当前 Hermes 实例。进行中的任务、会议发言或流水线步骤可能中断。`,
      confirmLabel: '停止实例',
      tone: 'warning',
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/agents/custom/${encodeURIComponent(agent.id)}/stop`, { method: 'POST' })
      const data = await res.json() as { agent?: CustomAgentView; error?: string }
      if (!res.ok || !data.agent) throw new Error(data.error || '停止失败')
      setCustomAgents((current) => current.map((item) => item.id === agent.id ? data.agent! : item))
      showToast('自定义 Agent 实例已停止', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '自定义 Agent 停止失败', 'error')
    }
  }

  if (error) {
    return (
      <ErrorState
        title="无法加载 Agent"
        message="请确保 Agent 服务已启动，然后重试。"
        onRetry={() => mutate()}
      />
    )
  }

  const onlineCount = agents.filter((a) => a.online).length
  const totalAgentCount = agents.length + customAgents.length

  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🤖 Agent 团队</h1>
          <p className="text-sm text-gray-500 mt-1">
            {greeting}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-sm font-medium">
            🟢 {onlineCount}/{agents.length} 在线
          </span>
          <span className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
            {totalAgentCount} 个团队角色
          </span>
          <Button onClick={() => setShowCreateForm((current) => !current)}>
            {showCreateForm ? '收起表单' : '添加 Agent'}
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <Card className="border-gray-200 bg-white/90 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-bold text-gray-900">新增本地 Agent</h2>
                <p className="text-sm text-gray-500 mt-1">
                  创建 Hermes Agent Profile；保存后可直接启动为真实 Hermes API Server 实例。
                </p>
              </div>
              <Badge variant="outline">Custom Registry</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="Agent 名称，例如 Legal Review Agent"
                value={customAgentForm.name}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, name: event.target.value }))}
              />
              <input
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="角色职责，例如 法律风险评估"
                value={customAgentForm.role}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, role: event.target.value }))}
              />
              <input
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="Skills，逗号分隔，例如 contract,risk,review"
                value={customAgentForm.skills}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, skills: event.target.value }))}
              />
              <select
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                value={customAgentForm.modelId || defaultModelId}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, modelId: event.target.value }))}
              >
                {modelProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name || profile.modelName || profile.id}
                  </option>
                ))}
              </select>
              <input
                className="md:col-span-2 h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="System Prompt，可选；不填则按角色自动生成"
                value={customAgentForm.systemPrompt}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, systemPrompt: event.target.value }))}
              />
              <textarea
                className="md:col-span-2 min-h-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
                placeholder="说明这个 Agent 的上下文、边界和交付物"
                value={customAgentForm.description}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, description: event.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCustomAgentForm(EMPTY_CUSTOM_AGENT_FORM)
                  setShowCreateForm(false)
                }}
              >
                取消
              </Button>
              <Button onClick={handleCreateCustomAgent} disabled={isSavingCustomAgent}>
                {isSavingCustomAgent ? '保存中...' : '保存 Agent'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent 角色卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : agents.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            <p className="text-4xl mb-4">😴</p>
            <p className="text-lg">暂无 Agent 在线</p>
            <p className="text-sm mt-2">请启动 Agent 服务后刷新</p>
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCharacterCard
              key={agent.id}
              agent={agent}
              isSelected={selectedAgent?.id === agent.id}
              onClick={() => setSelectedAgent(agent)}
              modelProfiles={modelProfiles}
              selectedModelId={getAgentModelId(agent.id)}
              onModelChange={(modelId) => assignBuiltinAgentModel(agent.id, modelId)}
            />
          ))
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">自定义 Agent 注册表</h2>
            <p className="text-sm text-gray-500 mt-1">
              用于扩展团队角色池；绑定 Endpoint 后可作为后续真实运行时接入对象。
            </p>
          </div>
          <Badge variant="secondary">{customAgents.length} 个</Badge>
        </div>

        {customAgentsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : customAgents.length === 0 ? (
          <Card className="border-dashed border-gray-300 bg-white/60">
            <CardContent className="p-6 text-center text-gray-500">
              <p className="text-sm">还没有自定义 Agent。点击右上角“添加 Agent”登记新的团队角色。</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {customAgents.map((agent) => (
              <CustomAgentCard
                key={agent.id}
                agent={agent}
                modelProfiles={modelProfiles}
                selectedModelId={getAgentModelId(agent.id, agent.modelId)}
                onModelChange={(modelId) => assignCustomAgentModel(agent, modelId)}
                onStart={() => handleStartCustomAgent(agent)}
                onStop={() => handleStopCustomAgent(agent)}
                onDelete={() => handleDeleteCustomAgent(agent)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 交互面板（点击后打开） */}
      {selectedAgent && (
        <AgentInteractionPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onChat={() => {
            if (!selectedAgent.online) {
              showToast('Agent 当前离线，无法对话', 'info')
              return
            }
            router.push(`/chat?agent=${selectedAgent.id}`)
          }}
          onViewTasks={() => {
            router.push('/kanban')
            setSelectedAgent(null)
          }}
          onViewDocs={() => {
            router.push(`/knowledge`)
          }}
        />
      )}
    </div>
  )
}
