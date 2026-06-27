'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useAgentHealth } from '@/hooks/useAgentHealth'
import type { ChatMessage } from '@/lib/types'

// ============================================================================
// Types
// ============================================================================

interface MeetingTopic {
  id: string
  topic: string
  createdAt: number
  participantAgentIds?: string[]
  messages: ChatMessage[]
}

/** Agent 实时状态 */
interface AgentStatus {
  agent: string
  name: string
  role?: string
  state: 'waiting' | 'thinking' | 'done' | 'error'
  output?: string
  error?: string
  toolCalls?: number
}

const STORAGE_KEY = 'open-agent-teams-meeting-v1'

// ============================================================================
// Storage
// ============================================================================

function loadMeetings(): Record<string, MeetingTopic> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch { return {} }
}

function saveMeetings(meetings: Record<string, MeetingTopic>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings))
}

// ============================================================================
// Component
// ============================================================================

export default function MeetingView() {
  const { availableAgents } = useAgentHealth()
  const defaultParticipantIds = useMemo(() => availableAgents.map(agent => agent.id), [availableAgents])
  const agentMap = useMemo(
    () => Object.fromEntries(availableAgents.map(agent => [agent.id, agent])),
    [availableAgents],
  )
  const [meetings, setMeetings] = useState<Record<string, MeetingTopic>>(() => loadMeetings())
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null)
  const [newTopicInput, setNewTopicInput] = useState('')
  const [newTopicParticipantIds, setNewTopicParticipantIds] = useState<string[]>([])
  const [discussionInput, setDiscussionInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showNewTopic, setShowNewTopic] = useState(false)
  /** 每个 Agent 的实时状态 */
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([])
  const { showToast } = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousDefaultParticipantIdsRef = useRef<string[]>([])

  useEffect(() => {
    const previousDefaultIds = previousDefaultParticipantIdsRef.current
    previousDefaultParticipantIdsRef.current = defaultParticipantIds
    if (defaultParticipantIds.length === 0) return
    setNewTopicParticipantIds((current) => {
      if (current.length === 0) return defaultParticipantIds
      const newlyAvailableIds = defaultParticipantIds.filter(id => !previousDefaultIds.includes(id))
      if (newlyAvailableIds.length === 0) return current
      return Array.from(new Set([...current, ...newlyAvailableIds]))
    })
  }, [defaultParticipantIds])

  // 持久化
  useEffect(() => {
    saveMeetings(meetings)
  }, [meetings])

  // 自动滚动
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeTopicId, meetings, agentStatuses])

  const activeTopic = activeTopicId ? meetings[activeTopicId] : null
  const activeParticipantIds = activeTopic
    ? (activeTopic.participantAgentIds ?? defaultParticipantIds)
    : defaultParticipantIds

  const toggleNewTopicParticipant = useCallback((agentId: string) => {
    setNewTopicParticipantIds(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    )
  }, [])

  const updateActiveParticipants = useCallback((updater: (ids: string[]) => string[]) => {
    if (!activeTopic) return
    setMeetings(prev => {
      const current = prev[activeTopic.id]
      if (!current) return prev
      const currentIds = current.participantAgentIds ?? defaultParticipantIds
      const nextIds = updater(currentIds).filter((id, index, arr) =>
        agentMap[id] && arr.indexOf(id) === index
      )
      return {
        ...prev,
        [activeTopic.id]: {
          ...current,
          participantAgentIds: nextIds,
        },
      }
    })
  }, [activeTopic, agentMap, defaultParticipantIds])

  const toggleActiveParticipant = useCallback((agentId: string) => {
    updateActiveParticipants(ids =>
      ids.includes(agentId)
        ? ids.filter(id => id !== agentId)
        : [...ids, agentId]
    )
  }, [updateActiveParticipants])

  // ── 新建议题 ──
  const handleCreateTopic = useCallback(() => {
    const topic = newTopicInput.trim()
    if (!topic) return
    if (newTopicParticipantIds.length === 0) {
      showToast('请至少邀请 1 个 Agent 参与会议', 'info')
      return
    }

    const id = `topic-${Date.now()}`
    const newTopic: MeetingTopic = {
      id,
      topic,
      createdAt: Date.now(),
      participantAgentIds: newTopicParticipantIds,
      messages: [{
        id: `system-${Date.now()}`,
        role: 'system',
        content: `🎙️ 会议开始：${topic}｜参会：${newTopicParticipantIds.map(id => agentMap[id]?.name || id).join('、')}`,
        agentId: 'system',
        timestamp: Date.now(),
      }],
    }

    setMeetings(prev => ({ ...prev, [id]: newTopic }))
    setActiveTopicId(id)
    setNewTopicInput('')
    setNewTopicParticipantIds(defaultParticipantIds)
    setShowNewTopic(false)
  }, [newTopicInput, newTopicParticipantIds, showToast, agentMap, defaultParticipantIds])

  // ── 删除议题 ──
  const handleDeleteTopic = useCallback((topicId: string) => {
    setMeetings(prev => {
      const next = { ...prev }
      delete next[topicId]
      return next
    })
    if (activeTopicId === topicId) {
      setActiveTopicId(null)
    }
  }, [activeTopicId])

  // ── 发起讨论（SSE 流式） ──
  const handleDiscuss = useCallback(async () => {
    const msg = discussionInput.trim()
    if (!msg || !activeTopic || sending) return
    if (activeParticipantIds.length === 0) {
      showToast('请至少邀请 1 个 Agent 参与会议', 'info')
      return
    }

    setDiscussionInput('')
    setSending(true)

    // 初始化被邀请 Agent 状态为 waiting
    const initialStatuses: AgentStatus[] = availableAgents.filter(a => activeParticipantIds.includes(a.id)).map(a => ({
      agent: a.id,
      name: a.name,
      state: 'waiting' as const,
    }))
    setAgentStatuses(initialStatuses)

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msg,
      agentId: 'user',
      timestamp: Date.now(),
    }

    setMeetings(prev => ({
      ...prev,
      [activeTopic.id]: {
        ...prev[activeTopic.id],
        messages: [...prev[activeTopic.id].messages, userMsg],
      },
    }))

    try {
      // 收集议题内的讨论上下文
      const discussionContext = activeTopic.messages
        .filter(m => m.role !== 'system')
        .map(m => {
          const label = m.role === 'user' ? '主持人' : (agentMap[m.agentId || '']?.name || m.agentId)
          return `### ${label}\n${m.content}`
        })
        .join('\n\n')

      const fullMessage = discussionContext
        ? `## 会议议题：${activeTopic.topic}\n\n## 之前的讨论\n${discussionContext}\n\n## 新的发言\n${msg}`
        : `## 会议议题：${activeTopic.topic}\n\n${msg}`

      // 使用 SSE 流式端点
      const res = await fetch('/api/meeting/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullMessage,
          topicId: activeTopic.id,
          sessionId: `meeting-${activeTopic.id}`,
          agents: activeParticipantIds,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue

          try {
            const event = JSON.parse(jsonStr)

            switch (event.type) {
              case 'agent_start':
                setAgentStatuses(prev => prev.map(s =>
                  s.agent === event.agent
                    ? { ...s, state: 'thinking', role: event.role }
                    : s
                ))
                break

              case 'thinking':
                setAgentStatuses(prev => prev.map(s =>
                  s.agent === event.agent
                    ? { ...s, state: 'thinking' }
                    : s
                ))
                break

              case 'output':
                setAgentStatuses(prev => prev.map(s =>
                  s.agent === event.agent
                    ? { ...s, state: 'done', output: event.output, toolCalls: event.toolCalls }
                    : s
                ))
                // 实时添加到讨论记录
                const agentMsg: ChatMessage = {
                  id: `agent-${Date.now()}-${event.agent}`,
                  role: 'assistant',
                  content: event.output,
                  agentId: event.agent,
                  timestamp: Date.now(),
                }
                setMeetings(prev => ({
                  ...prev,
                  [activeTopic.id]: {
                    ...prev[activeTopic.id],
                    messages: [...prev[activeTopic.id].messages, agentMsg],
                  },
                }))
                break

              case 'error':
                setAgentStatuses(prev => prev.map(s =>
                  s.agent === event.agent
                    ? { ...s, state: 'error', error: event.error }
                    : s
                ))
                break

              case 'done':
                break
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (e) {
      showToast(`Meeting failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error')
    }

    setSending(false)
    setAgentStatuses([])
  }, [discussionInput, activeTopic, activeParticipantIds, sending, showToast, availableAgents, agentMap])

  // ── 排序后的议题列表 ──
  const sortedTopics = Object.values(meetings).sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="flex h-[calc(100vh-200px)] gap-4">
      {/* 左侧：议题列表 */}
      <div className="w-72 flex flex-col border rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">🎙️ 会议议题</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNewTopic(!showNewTopic)}
            className="text-blue-500 hover:text-blue-600"
          >
            + 新建
          </Button>
        </div>

        {showNewTopic && (
          <div className="p-3 border-b bg-blue-50">
            <input
              type="text"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="输入会议议题..."
              value={newTopicInput}
              onChange={e => setNewTopicInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateTopic()}
              autoFocus
            />
            <div className="mt-3 rounded-lg border border-blue-100 bg-white/80 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-600">邀请 Agent</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:text-blue-700"
                    onClick={() => setNewTopicParticipantIds(defaultParticipantIds)}
                  >
                    全选
                  </button>
                  <span className="text-xs text-gray-300">/</span>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:text-blue-700"
                    onClick={() => setNewTopicParticipantIds([])}
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {availableAgents.map(agent => {
                  const selected = newTopicParticipantIds.includes(agent.id)
                  return (
                    <button
                      type="button"
                      key={agent.id}
                      className={`rounded-md border px-2 py-1 text-left text-xs transition ${
                        selected
                          ? 'border-purple-300 bg-purple-50 text-purple-700'
                          : 'border-gray-200 bg-white text-gray-500'
                      }`}
                      onClick={() => toggleNewTopicParticipant(agent.id)}
                    >
                      <span className="mr-1">{agent.icon}</span>
                      {agent.name}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 text-xs text-gray-400">
                已邀请 {newTopicParticipantIds.length}/{availableAgents.length}
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={handleCreateTopic} className="flex-1">创建</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewTopic(false)}>取消</Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {sortedTopics.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">
              <div className="text-2xl mb-2">🎙️</div>
              <p>点击"新建"创建会议议题</p>
              <p className="text-xs mt-1">每个议题独立上下文</p>
            </div>
          ) : (
            sortedTopics.map(topic => {
              const msgCount = topic.messages.filter(m => m.role !== 'system').length
              return (
                <div
                  key={topic.id}
                  className={`group px-4 py-3 border-b cursor-pointer hover:bg-purple-50 transition-colors ${
                    activeTopicId === topic.id ? 'bg-purple-50 border-l-2 border-l-purple-500' : ''
                  }`}
                  onClick={() => setActiveTopicId(topic.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{topic.topic}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(topic.createdAt).toLocaleDateString()} · {msgCount} 条讨论
                      </div>
                    </div>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-2 text-xs transition-opacity"
                      onClick={e => { e.stopPropagation(); handleDeleteTopic(topic.id) }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 右侧：讨论区域 */}
      <div className="flex-1 flex flex-col">
        {!activeTopic ? (
          <Card className="flex-1">
            <CardContent className="h-full flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="text-5xl mb-3">🎙️</div>
                <p className="text-lg font-medium">选择或创建一个会议议题</p>
                <p className="text-sm mt-1">每个议题独立上下文，Agent 依次发言讨论</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* 议题标题 */}
            <div className="mb-3 px-4 py-3 bg-white border rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">🎙️ {activeTopic.topic}</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    {activeTopic.messages.filter(m => m.role !== 'system').length} 条讨论 · {activeParticipantIds.length}/{availableAgents.length} 位 Agent 参会
                  </p>
                </div>
                <div className="flex gap-1">
                  {availableAgents.filter(a => activeParticipantIds.includes(a.id)).map(a => (
                    <span key={a.id} className="text-lg" title={a.name}>{a.icon}</span>
                  ))}
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-gray-100 bg-slate-50 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-600">参会 Agent</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="text-xs text-purple-600 hover:text-purple-700 disabled:text-gray-300"
                      disabled={sending}
                      onClick={() => updateActiveParticipants(() => defaultParticipantIds)}
                    >
                      全选
                    </button>
                    <span className="text-xs text-gray-300">/</span>
                    <button
                      type="button"
                      className="text-xs text-purple-600 hover:text-purple-700 disabled:text-gray-300"
                      disabled={sending}
                      onClick={() => updateActiveParticipants(() => [])}
                    >
                      清空
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {availableAgents.map(agent => {
                    const selected = activeParticipantIds.includes(agent.id)
                    return (
                      <button
                        type="button"
                        key={agent.id}
                        disabled={sending}
                        className={`rounded-md border px-2 py-1 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          selected
                            ? 'border-purple-300 bg-purple-50 text-purple-700'
                            : 'border-gray-200 bg-white text-gray-500'
                        }`}
                        onClick={() => toggleActiveParticipant(agent.id)}
                      >
                        <span className="mr-1">{agent.icon}</span>
                        {agent.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Agent 实时状态面板 */}
            {sending && agentStatuses.length > 0 && (
              <div className="mb-3 grid grid-cols-5 gap-2">
                {agentStatuses.map(s => {
                  const agent = agentMap[s.agent]
                  return (
                    <div
                      key={s.agent}
                      className={`border rounded-lg p-2 text-center text-xs transition-all ${
                        s.state === 'thinking'
                          ? 'border-purple-400 bg-purple-50 animate-pulse'
                          : s.state === 'done'
                          ? 'border-green-400 bg-green-50'
                          : s.state === 'error'
                          ? 'border-red-400 bg-red-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="text-base mb-1">{agent?.icon || '🤖'}</div>
                      <div className="font-medium truncate">{s.name}</div>
                      <div className={`mt-1 ${
                        s.state === 'thinking' ? 'text-purple-600' :
                        s.state === 'done' ? 'text-green-600' :
                        s.state === 'error' ? 'text-red-600' :
                        'text-gray-400'
                      }`}>
                        {s.state === 'waiting' && '⏳ 等待中'}
                        {s.state === 'thinking' && '🧠 思考中...'}
                        {s.state === 'done' && `✅ 完成${s.toolCalls ? ` (${s.toolCalls} 操作)` : ''}`}
                        {s.state === 'error' && '❌ 失败'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 讨论消息 */}
            <Card className="flex-1 overflow-hidden mb-3">
              <CardContent className="h-full overflow-y-auto p-4 space-y-4">
                {activeTopic.messages.map(msg => {
                  if (msg.role === 'system') {
                    return (
                      <div key={msg.id} className="text-center">
                        <span className="inline-block px-3 py-1 bg-purple-100 text-purple-600 text-xs rounded-full">
                          {msg.content}
                        </span>
                      </div>
                    )
                  }

                  if (msg.role === 'user') {
                    return (
                      <div key={msg.id} className="flex justify-end">
                        <div className="max-w-[70%] bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-2xl p-4 shadow-lg">
                          <div className="text-sm opacity-80 mb-1">🎤 主持人</div>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      </div>
                    )
                  }

                  const agent = agentMap[msg.agentId || '']
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] bg-white border rounded-2xl p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                          <span className="text-lg">{agent?.icon || '🤖'}</span>
                          <span className="font-medium text-sm text-gray-700">{agent?.name || msg.agentId}</span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-gray-700">{msg.content}</div>
                      </div>
                    </div>
                  )
                })}

                <div ref={scrollRef} />
              </CardContent>
            </Card>

            {/* 输入区域 */}
            <div className="border-t p-4 bg-slate-50 rounded-xl">
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder={`在"${activeTopic.topic}"中发言...`}
                  value={discussionInput}
                  onChange={e => setDiscussionInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleDiscuss()}
                  disabled={sending}
                  maxLength={10000}
                />
                <Button
                  onClick={handleDiscuss}
                  disabled={sending || !discussionInput.trim()}
                  className="bg-purple-500 hover:bg-purple-600"
                >
                  {sending ? '⏳ 讨论中...' : '🎙️ 讨论'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
