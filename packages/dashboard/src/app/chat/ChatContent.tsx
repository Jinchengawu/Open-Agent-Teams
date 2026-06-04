'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { AGENTS, detectAgent } from '@/lib/agents'
import type { ChatMessage } from '@/lib/types'

const AGENT_LIST = Object.entries(AGENTS).map(([, info]) => ({ ...info }))
const MAX_INPUT_LENGTH = 10000
const SESSION_STORAGE_KEY = 'dev-agent-chat-v1'

function getWelcomeMessage(agentId: string): ChatMessage {
  if (!agentId) return {
    id: 'welcome',
    role: 'assistant',
    content: "Hello! I'm DEV-Agent-Teams. Select an agent tab above to start a conversation.",
    agentId: 'system',
    timestamp: Date.now(),
  }
  const info = AGENTS[agentId]
  if (!info) return {
    id: 'welcome',
    role: 'assistant',
    content: 'How can I help?',
    agentId: 'system',
    timestamp: Date.now(),
  }
  return {
    id: `welcome-${agentId}`,
    role: 'assistant',
    content: `Hi, I'm the ${info.name}. I specialize in ${info.label}. How can I help you today?`,
    agentId: info.id,
    timestamp: Date.now(),
  }
}

function loadConversations(): Record<string, ChatMessage[]> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveConversations(convs: Record<string, ChatMessage[]>) {
  if (typeof window === 'undefined') return
  try {
    const trimmed: Record<string, ChatMessage[]> = {}
    for (const [key, msgs] of Object.entries(convs)) {
      trimmed[key] = msgs.slice(-50)
    }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(trimmed))
  } catch { /* ignore quota errors */ }
}

interface AgentTab {
  id: string
  input: string
}

export default function ChatContent() {
  const searchParams = useSearchParams()
  const { showToast } = useToast()
  const initialAgent = searchParams.get('agent') || ''

  // 多 Tab 管理 — 持久化到 localStorage，路由切换不丢失
  const TABS_STORAGE_KEY = 'dev-agent-chat-tabs-v1'
  const [tabs, setTabs] = useState<AgentTab[]>(() => {
    if (typeof window === 'undefined') return initialAgent ? [{ id: initialAgent, input: '' }] : []
    try {
      const raw = localStorage.getItem(TABS_STORAGE_KEY)
      const saved = raw ? JSON.parse(raw) as AgentTab[] : []
      // URL 参数指定了 agent 但还没在 tabs 中，追加
      if (initialAgent && !saved.find(t => t.id === initialAgent)) {
        return [...saved, { id: initialAgent, input: '' }]
      }
      return saved.length > 0 ? saved : []
    } catch { return initialAgent ? [{ id: initialAgent, input: '' }] : [] }
  })
  const [activeTab, setActiveTab] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    try {
      return parseInt(localStorage.getItem('dev-agent-chat-active-v1') || '0', 10)
    } catch { return 0 }
  })
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>(() => loadConversations())
  const [sessions, setSessions] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = localStorage.getItem('dev-agent-sessions-v1')
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })

  // 每个 Agent 独立的发送状态（并发关键）
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const sendingRef = useRef<Record<string, boolean>>({})
  const mountedRef = useRef(true)
  const messagesEndRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const welcomeCache = useRef<Record<string, ChatMessage>>({})
  const getCachedWelcome = useCallback((key: string) => {
    if (!welcomeCache.current[key]) {
      welcomeCache.current[key] = getWelcomeMessage(key === 'auto' ? '' : key)
    }
    return welcomeCache.current[key]
  }, [])

  const activeAgentId = tabs[activeTab]?.id || ''
  const activeKey = activeAgentId || 'auto'
  const currentMessages = conversations[activeKey] || [getCachedWelcome(activeKey)]
  const currentSessionId = sessions[activeKey] || ''

  // 自动滚动
  useEffect(() => {
    const ref = messagesEndRefs.current[activeKey]
    ref?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages, activeKey])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => { saveConversations(conversations) }, [conversations])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('dev-agent-sessions-v1', JSON.stringify(sessions))
    }
  }, [sessions])

  // 持久化 tabs 和 activeTab，路由切换不丢失
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs))
      localStorage.setItem('dev-agent-chat-active-v1', String(activeTab))
    }
  }, [tabs, activeTab])

  // 打开 Tab
  const openTab = useCallback((agentId: string) => {
    setTabs((prev) => {
      const existing = prev.findIndex((t) => t.id === agentId)
      if (existing >= 0) {
        setActiveTab(existing)
        return prev
      }
      const next = [...prev, { id: agentId, input: '' }]
      setActiveTab(next.length - 1)
      return next
    })
  }, [])

  // 关闭 Tab
  const closeTab = useCallback((index: number) => {
    setTabs((prev) => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0) {
        setActiveTab(0)
        return next
      }
      if (activeTab >= next.length) {
        setActiveTab(next.length - 1)
      }
      return next
    })
  }, [activeTab])

  // 更新 Tab 输入
  const setTabInput = useCallback((agentId: string, value: string) => {
    setTabs((prev) => prev.map((t) => t.id === agentId ? { ...t, input: value } : t))
  }, [])

  const addMessage = useCallback((key: string, msg: ChatMessage) => {
    if (!mountedRef.current) return
    setConversations((prev) => {
      const msgs = [...(prev[key] || [getCachedWelcome(key)])]
      msgs.push(msg)
      return { ...prev, [key]: msgs }
    })
  }, [getCachedWelcome])

  const clearConversation = useCallback((agentId: string) => {
    setConversations((prev) => {
      const next = { ...prev }
      delete next[agentId]
      return next
    })
    setSessions((prev) => {
      const next = { ...prev }
      delete next[agentId]
      return next
    })
  }, [])

  // 并发安全的发送（per-agent lock）
  const handleSendForAgent = useCallback(async (agentId: string, text: string) => {
    if (!text.trim() || sendingRef.current[agentId]) return

    sendingRef.current[agentId] = true
    setSending((prev) => ({ ...prev, [agentId]: true }))
    setTabInput(agentId, '')

    const key = agentId
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}-${agentId}`,
      role: 'user',
      content: text,
      agentId,
      timestamp: Date.now(),
    }

    const existingHistory = (conversations[key] || [])
      .filter((m) => !m.id.startsWith('welcome'))
      .map((m) => ({ role: m.role, content: m.content }))
    existingHistory.push({ role: 'user', content: text })

    addMessage(key, userMessage)

    const sessionId = sessions[key] || undefined

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: existingHistory, agentId, sessionId }),
      })

      let data: Record<string, unknown> = {}
      try {
        data = await res.json()
      } catch {
        const errText = await res.clone().text().catch(() => '')
        throw new Error(errText.substring(0, 200) || `HTTP ${res.status}`)
      }

      if (!res.ok || data.error) {
        throw new Error((data.error as string) || `HTTP ${res.status}`)
      }

      if (data.sessionId) {
        setSessions((prev) => ({ ...prev, [key]: data.sessionId as string }))
      }

      const agentMessage: ChatMessage = {
        id: `agent-${Date.now()}-${agentId}`,
        role: 'assistant',
        content: (data.message as Record<string, unknown>)?.content as string || 'No response.',
        agentId,
        timestamp: Date.now(),
      }
      addMessage(key, agentMessage)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error'
      showToast(`[${AGENTS[agentId]?.name || agentId}] ${errorMsg}`, 'error')

      addMessage(key, {
        id: `error-${Date.now()}-${agentId}`,
        role: 'assistant',
        content: `⚠️ ${errorMsg}`,
        agentId: 'system',
        timestamp: Date.now(),
      })
    } finally {
      if (mountedRef.current) {
        setSending((prev) => ({ ...prev, [agentId]: false }))
      }
      sendingRef.current[agentId] = false
    }
  }, [conversations, sessions, addMessage, showToast, setTabInput])

  const handleSendWithTextRef = useRef(handleSendForAgent)
  handleSendWithTextRef.current = handleSendForAgent

  const currentInput = tabs.find((t) => t.id === activeAgentId)?.input || ''
  const isCurrentSending = !!sending[activeAgentId]

  function getAgentDisplayInfo(agentId: string | undefined) {
    if (!agentId || agentId === 'system') return { icon: '🤖', name: 'System' }
    const agent = AGENTS[agentId]
    if (!agent) return { icon: '🤖', name: 'System' }
    return { icon: agent.icon, name: agent.name }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      {/* ── Agent Tabs ── */}
      <div className="flex items-end gap-0.5 mb-2 border-b border-slate-200 pb-0">
        <div className="flex items-end gap-0.5 overflow-x-auto flex-1 pb-0">
          {tabs.map((tab, i) => {
            const agent = AGENTS[tab.id]
            const isActive = i === activeTab
            const isSending = !!sending[tab.id]
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(i)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-white border border-b-0 border-slate-200 text-gray-900 font-medium -mb-px'
                    : 'bg-transparent text-gray-500 hover:text-gray-700 hover:bg-slate-50 border border-transparent'
                }`}
              >
                <span>{agent?.icon || '🤖'}</span>
                <span className="max-w-[100px] truncate">{agent?.name || agent?.label || 'Auto'}</span>
                {isSending && (
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse flex-shrink-0" />
                )}
                <span
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); closeTab(i) }}
                  className="ml-0.5 text-gray-400 hover:text-red-500 text-xs flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-red-50"
                >
                  ×
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center justify-center w-7 h-7 mb-1 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-base font-medium"
          >
            +
          </button>
          {showAddMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 min-w-[180px] overflow-hidden">
              <div className="px-3 py-2 text-xs text-gray-400 border-b border-slate-100">Add Agent</div>
              {AGENT_LIST.map((agent) => (
                <button
                  key={agent.id}
                  onMouseDown={(e) => { e.preventDefault(); openTab(agent.id); setShowAddMenu(false) }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-left hover:bg-blue-50 transition-colors"
                >
                  <span className="text-lg">{agent.icon}</span>
                  <div>
                    <div className="font-medium text-gray-900">{agent.name}</div>
                    <div className="text-xs text-gray-400">{agent.label}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 活动 Tab 的对话 ── */}
      {tabs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-2xl">
            <div className="text-5xl mb-6">🧠</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">DEV-Agent-Teams</h2>
            <p className="text-gray-500 mb-8">选择一个 Agent 开始对话，支持同时打开多个标签页并发对话</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {AGENT_LIST.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => openTab(agent.id)}
                  className="flex items-center gap-3 px-5 py-4 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:shadow-md transition-all text-left group"
                >
                  <span className="text-2xl group-hover:scale-110 transition-transform">{agent.icon}</span>
                  <div>
                    <div className="font-semibold text-gray-900">{agent.name}</div>
                    <div className="text-xs text-gray-400">{agent.label}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Card className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b bg-white">
            <div className="flex items-center gap-2">
              <span className="text-lg">
                {AGENTS[activeAgentId]?.icon || '🤖'}
              </span>
              <span className="font-medium text-gray-900">
                {AGENTS[activeAgentId]?.name || 'Chat'}
              </span>
              {isCurrentSending && (
                <span className="text-xs text-blue-500 animate-pulse">thinking...</span>
              )}
            </div>
            <div className="flex gap-2">
              {currentMessages.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => clearConversation(activeKey)}>
                  🗑️ Clear
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={isCurrentSending || !currentInput.trim()}
                onClick={async () => {
                  const msg = currentInput.trim()
                  if (!msg) return
                  // 广播到所有已打开的标签
                  const targets = tabs.map(t => t.id)
                  if (targets.length === 0) return
                  setTabInput(activeAgentId, '')
                  // 在当前对话中显示广播消息
                  addMessage(activeKey, {
                    id: `user-${Date.now()}-broadcast`,
                    role: 'user',
                    content: `📢 Broadcast to ${targets.length} agents: ${msg}`,
                    agentId: activeAgentId,
                    timestamp: Date.now(),
                  })
                  // 并发发送
                  try {
                    const res = await fetch('/api/collab', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ message: msg, agents: targets }),
                    })
                    const data = await res.json()
                    for (const r of (data.responses || [])) {
                      const agentInfo = AGENTS[r.agent] || { icon: '🤖', name: r.agent }
                      addMessage(activeKey, {
                        id: `agent-${Date.now()}-${r.agent}`,
                        role: 'assistant',
                        content: r.content,
                        agentId: r.agent,
                        timestamp: Date.now(),
                      })
                    }
                  } catch (e) {
                    showToast(`Broadcast failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error')
                  }
                }}
              >
                📢 Broadcast
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isCurrentSending || !currentInput.trim()}
                className="border-purple-300 text-purple-600 hover:bg-purple-50"
                onClick={async () => {
                  const msg = currentInput.trim()
                  if (!msg) return
                  const targets = tabs.map(t => t.id)
                  if (targets.length === 0) return
                  setTabInput(activeAgentId, '')
                  addMessage(activeKey, {
                    id: `user-${Date.now()}-meeting`,
                    role: 'user',
                    content: `🎙️ Meeting (${targets.length} agents): ${msg}`,
                    agentId: activeAgentId,
                    timestamp: Date.now(),
                  })
                  try {
                    const res = await fetch('/api/collab', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ message: msg, agents: targets, mode: 'meeting' }),
                    })
                    const data = await res.json()
                    for (const r of (data.responses || [])) {
                      const agentInfo = AGENTS[r.agent] || { icon: '🤖', name: r.agent }
                      addMessage(activeKey, {
                        id: `agent-${Date.now()}-${r.agent}`,
                        role: 'assistant',
                        content: r.content,
                        agentId: r.agent,
                        timestamp: Date.now(),
                      })
                    }
                  } catch (e) {
                    showToast(`Meeting failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error')
                  }
                }}
              >
                🎙️ Meeting
              </Button>
            </div>
          </div>

          {/* Messages */}
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
            {currentMessages.map((message) => {
              const displayInfo = getAgentDisplayInfo(message.agentId)
              const isError = message.id.startsWith('error-')
              const lastUserMsg = [...currentMessages].reverse().find((m) => m.role === 'user')

              return (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl p-4 ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                        : isError
                        ? 'bg-red-50 border border-red-200 text-gray-900'
                        : 'bg-white border border-slate-200 text-gray-900 shadow-sm'
                    }`}
                  >
                    <div
                      className={`text-xs font-medium mb-2 flex items-center space-x-2 ${
                        message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}
                    >
                      <span className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center text-xs">
                        {displayInfo.icon}
                      </span>
                      <span>{displayInfo.name}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                    </div>
                    <div className={`text-xs mt-2 ${message.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                      {message.timestamp > 1000000000000
                        ? new Date(message.timestamp).toLocaleTimeString()
                        : ''}
                    </div>
                    {isError && lastUserMsg && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 text-xs"
                        onClick={() => {
                          const retryAgent = (message.agentId && message.agentId !== 'system') ? message.agentId : activeAgentId
                          handleSendWithTextRef.current(retryAgent || 'backend', lastUserMsg.content)
                        }}
                      >
                        🔄 Retry
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}

            {isCurrentSending && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center space-x-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                    <span className="text-sm text-gray-500">Agent thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={(el) => { messagesEndRefs.current[activeKey] = el }} />
          </CardContent>

          {/* Input */}
          <div className="border-t p-4 bg-slate-50">
            <div className="flex space-x-3">
              <input
                type="text"
                value={currentInput}
                onChange={(e) => setTabInput(activeAgentId, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (activeAgentId) {
                      const input = tabs.find((t) => t.id === activeAgentId)?.input || ''
                      handleSendForAgent(activeAgentId, input)
                    }
                  }
                }}
                placeholder={`Message ${AGENTS[activeAgentId]?.name || activeAgentId}...`}
                disabled={isCurrentSending}
                maxLength={MAX_INPUT_LENGTH}
                className="flex-1 border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm disabled:opacity-50"
              />
              <Button
                onClick={() => handleSendForAgent(activeAgentId, currentInput)}
                disabled={!currentInput.trim() || isCurrentSending}
                size="lg"
              >
                Send →
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: 'React component', text: 'Create a React login component with TypeScript and Tailwind CSS' },
                { label: 'Design API', text: 'Design a RESTful user API endpoint with Express' },
                { label: 'Write tests', text: 'Write unit tests for an authentication module' },
                { label: 'Create Dockerfile', text: 'Create a Dockerfile for a Node.js application' },
              ].map((suggestion) => (
                <Button
                  key={suggestion.label}
                  variant="outline"
                  size="sm"
                  onClick={() => setTabInput(activeAgentId, suggestion.text)}
                  className="text-xs"
                  disabled={isCurrentSending}
                >
                  💡 {suggestion.label}
                </Button>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
