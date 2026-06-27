'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { useToast } from '@/components/ui/toast'
import { useAgentHealth } from '@/hooks/useAgentHealth'
import type { AgentStatus } from '@/lib/types'

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
}

const EMPTY_CUSTOM_AGENT_FORM: CustomAgentForm = {
  name: '',
  role: '',
  description: '',
  skills: '',
  systemPrompt: '',
}

const AGENT_PERSONALITIES: Record<string, AgentPersonality> = {
  'intent-router': {
    avatar: '🧭',
    accentColor: 'from-cyan-400 to-blue-500',
    greeting: '我负责把输入需求路由到合适的协同模式。',
    signature: '先识别意图，再组织团队',
    mood: '校准中 🎯',
    roleDescription: '多模态智能意图路由，判断需求复杂度与处理路径',
    specialties: ['Intent', 'Routing', 'Triage', 'Complexity', 'Mode Select'],
    catchphrase: '先分清问题形态。',
  },
  'team-orchestrator': {
    avatar: '🕸️',
    accentColor: 'from-indigo-400 to-violet-500',
    greeting: '我负责召集团队、组织会议与串联协作。',
    signature: '让多个 Agent 像团队一样工作',
    mood: '统筹中 🧩',
    roleDescription: '团队编排中枢，管理会议模式、角色协作与任务分派',
    specialties: ['Meeting', 'Coordination', 'Delegation', 'Role Binding', 'Events'],
    catchphrase: '把面组织成系统。',
  },
  'workflow-conductor': {
    avatar: '🔁',
    accentColor: 'from-emerald-400 to-teal-500',
    greeting: '我负责把确定流程推进成可恢复的 Pipeline。',
    signature: '串行执行，状态可控',
    mood: '推进中 🚦',
    roleDescription: '工作流执行 Agent，负责 Pipeline、Surface、Gate 与恢复控制',
    specialties: ['Pipeline', 'Surface', 'Gate', 'Pause/Resume', 'Rollback'],
    catchphrase: '让流程跑完闭环。',
  },
  'knowledge-steward': {
    avatar: '🧠',
    accentColor: 'from-amber-400 to-orange-500',
    greeting: '我负责把文档、经验和上下文沉淀为组织记忆。',
    signature: '没有沉淀，就没有组织',
    mood: '整理中 📚',
    roleDescription: '知识与文档 Agent，串联文档、任务、工作流与经验资产',
    specialties: ['Document', 'Knowledge', 'RAG', 'Context', 'Experience'],
    catchphrase: '把经验留下来。',
  },
  'recovery-agent': {
    avatar: '🛠️',
    accentColor: 'from-rose-400 to-red-500',
    greeting: '我负责故障自检、诊断、回滚与修复建议。',
    signature: '系统要能自己站起来',
    mood: '巡检中 🩺',
    roleDescription: '系统故障自检修复 Agent，覆盖诊断、恢复和质量门禁',
    specialties: ['Diagnosis', 'Recovery', 'Rollback', 'Quality Gate', 'Audit'],
    catchphrase: '先止血，再复盘。',
  },
  'integration-agent': {
    avatar: '🔌',
    accentColor: 'from-slate-500 to-gray-700',
    greeting: '我负责 Hermes、MCP、A2A 与外部工具协议集成。',
    signature: '边界清晰，协议可靠',
    mood: '接线中 ⚡',
    roleDescription: '协议与集成 Agent，管理运行时适配、工具接入与跨系统通信',
    specialties: ['Hermes', 'MCP', 'A2A', 'Adapters', 'Tools'],
    catchphrase: '把接口接稳。',
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
}: {
  agent: AgentStatus
  isSelected: boolean
  onClick: () => void
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
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
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
        </CardContent>
      </Card>
    </div>
  )
}

function CustomAgentCard({
  agent,
  onStart,
  onStop,
  onDelete,
}: {
  agent: CustomAgentView
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
  const { agents, isLoading, error, mutate } = useAgentHealth()
  const [selectedAgent, setSelectedAgent] = useState<AgentStatus | null>(null)
  const [customAgents, setCustomAgents] = useState<CustomAgentView[]>([])
  const [customAgentsLoading, setCustomAgentsLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [customAgentForm, setCustomAgentForm] = useState<CustomAgentForm>(EMPTY_CUSTOM_AGENT_FORM)
  const [isSavingCustomAgent, setIsSavingCustomAgent] = useState(false)

  // 欢迎语动画
  const [greeting, setGreeting] = useState('')
  useEffect(() => {
    const greetings = [
      '欢迎来到 Agent Teams 框架层！👋',
      '协作原型 Agent 已就绪！🚀',
      '6 个框架 Agent 原型随时待命！💪',
      '点击任意 Agent 查看职责边界！🎯',
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

    setIsSavingCustomAgent(true)
    try {
      const res = await fetch('/api/agents/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customAgentForm),
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
          <h1 className="text-2xl font-bold text-gray-900">🤖 Framework Agent 原型</h1>
          <p className="text-sm text-gray-500 mt-1">
            {greeting}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-sm font-medium">
            🟢 {onlineCount}/{agents.length} 在线
          </span>
          <span className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
            {totalAgentCount} 个框架角色
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
                <h2 className="font-bold text-gray-900">新增框架 Agent 原型</h2>
                <p className="text-sm text-gray-500 mt-1">
                  创建可复用 Hermes Agent Profile；保存后可直接启动为真实 Hermes API Server 实例。
                </p>
              </div>
              <Badge variant="outline">Framework Registry</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="Agent 名称，例如 Legal Risk Agent"
                value={customAgentForm.name}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, name: event.target.value }))}
              />
              <input
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="角色职责，例如 风险评估与审查"
                value={customAgentForm.role}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, role: event.target.value }))}
              />
              <input
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="Skills，逗号分隔，例如 contract,risk,review"
                value={customAgentForm.skills}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, skills: event.target.value }))}
              />
              <input
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-900"
                placeholder="System Prompt，可选；不填则按角色自动生成"
                value={customAgentForm.systemPrompt}
                onChange={(event) => setCustomAgentForm((form) => ({ ...form, systemPrompt: event.target.value }))}
              />
              <textarea
                className="md:col-span-2 min-h-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
                placeholder="说明这个 Agent 原型的上下文、边界和交付物"
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
            />
          ))
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">自定义 Agent 原型注册表</h2>
            <p className="text-sm text-gray-500 mt-1">
              用于框架层沉淀可复用角色池；绑定 Endpoint 后可作为下游团队运行时接入对象。
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
              <p className="text-sm">还没有自定义 Agent 原型。点击右上角“添加 Agent”登记新的框架角色。</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {customAgents.map((agent) => (
              <CustomAgentCard
                key={agent.id}
                agent={agent}
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
