'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
    content: "Hello! I'm DEV-Agent-Teams. I can help you with:\n\n• 🎨 Frontend development (React, Vue, TypeScript)\n• ⚙️ Backend development (Python, Node.js, Go)\n• 🧪 Testing (pytest, Jest, Playwright)\n• 🚀 DevOps (Docker, Kubernetes, CI/CD)\n• 📋 Product Management (PRD, user stories, requirements)\n\nWhat would you like to work on?",
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
    // Only persist recent messages (max 50 per agent)
    const trimmed: Record<string, ChatMessage[]> = {}
    for (const [key, msgs] of Object.entries(convs)) {
      trimmed[key] = msgs.slice(-50)
    }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(trimmed))
  } catch { /* ignore quota errors */ }
}

export default function ChatContent() {
  const searchParams = useSearchParams()
  const { showToast } = useToast()
  const initialAgent = searchParams.get('agent') || ''

  const [selectedAgent, setSelectedAgent] = useState<string>(initialAgent)
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>(() => loadConversations())
  const [sessions, setSessions] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = localStorage.getItem('dev-agent-sessions-v1')
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const mountedRef = useRef(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const agentKey = selectedAgent || 'auto'

  // BUG 3 fix: memoize welcome message
  const welcomeCache = useRef<Record<string, ChatMessage>>({})
  const getCachedWelcome = useCallback((key: string) => {
    if (!welcomeCache.current[key]) {
      welcomeCache.current[key] = getWelcomeMessage(key === 'auto' ? '' : key)
    }
    return welcomeCache.current[key]
  }, [])

  const currentMessages = conversations[agentKey] || [getCachedWelcome(agentKey)]
  const currentSessionId = sessions[agentKey] || ''

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [currentMessages, isSending, scrollToBottom])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (initialAgent) {
      setSelectedAgent(initialAgent)
    }
  }, [initialAgent])

  useEffect(() => {
    saveConversations(conversations)
  }, [conversations])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('dev-agent-sessions-v1', JSON.stringify(sessions))
    }
  }, [sessions])

  const addMessage = useCallback((key: string, msg: ChatMessage) => {
    if (!mountedRef.current) return
    setConversations((prev) => {
      const msgs = [...(prev[key] || [getCachedWelcome(key)])]
      msgs.push(msg)
      return { ...prev, [key]: msgs }
    })
  }, [getCachedWelcome])

  const clearConversation = useCallback(() => {
    setConversations((prev) => {
      const next = { ...prev }
      delete next[agentKey]
      return next
    })
    setSessions((prev) => {
      const next = { ...prev }
      delete next[agentKey]
      return next
    })
    showToast('Conversation cleared', 'info')
  }, [agentKey, showToast])

  const handleSendWithText = async (text: string, targetAgent: string, clearInput = false) => {
    if (isSendingRef.current) return
    isSendingRef.current = true
    setIsSending(true)
    if (clearInput) setInput('')

    const key = agentKey
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      agentId: targetAgent,
      timestamp: Date.now(),
    }

    // BUG 4 fix: build history BEFORE adding the message
    const existingHistory = (conversations[key] || [])
      .filter((m) => !m.id.startsWith('welcome'))
      .map((m) => ({ role: m.role, content: m.content }))
    existingHistory.push({ role: 'user', content: text })

    addMessage(key, userMessage)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: existingHistory,
          agentId: targetAgent,
          sessionId: currentSessionId || undefined,
        }),
      })

      let data: Record<string, unknown> = {}
      try {
        data = await res.json()
      } catch {
        // BUG 6 fix: non-JSON response
        const text = await res.clone().text().catch(() => '')
        throw new Error(text.substring(0, 200) || `HTTP ${res.status}`)
      }

      if (!res.ok || data.error) {
        throw new Error((data.error as string) || `HTTP ${res.status}`)
      }

      // BUG 2 fix: always update sessionId
      if (data.sessionId) {
        setSessions((prev) => ({ ...prev, [key]: data.sessionId as string }))
      }

      const agentMessage: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: 'assistant',
        content: (data.message as Record<string, unknown>)?.content as string || 'No response from agent.',
        agentId: targetAgent,
        timestamp: Date.now(),
      }
      addMessage(key, agentMessage)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error'
      showToast(`Send failed: ${errorMsg}`, 'error')

      // BUG 11 fix: retry button
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Failed to reach agent.\n\n${errorMsg}\n\nMake sure the agent services are running. You can click the Retry button below or start agents with:\n\`./scripts/start-all.sh\``,
        agentId: 'system',
        timestamp: Date.now(),
      }
      addMessage(key, errorMessage)
    } finally {
      if (mountedRef.current) {
        setIsSending(false)
      }
      isSendingRef.current = false
    }
  }

  const handleSendWithTextRef = useRef(handleSendWithText)
  handleSendWithTextRef.current = handleSendWithText

  const handleRetry = useCallback((retryText: string, retryAgent: string) => {
    setInput(retryText)
    // Trigger send after a tick
    setTimeout(() => {
      handleSendWithTextRef.current(retryText, retryAgent)
    }, 100)
  }, [])

  const handleSend = async () => {
    if (!input.trim() || isSendingRef.current) return
    await handleSendWithText(input.trim(), selectedAgent || detectAgent(input.trim()), true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // BUG 8 fix: clear input on agent switch
  const handleSwitchAgent = (id: string) => {
    if (id !== selectedAgent) {
      setInput('')
      setSelectedAgent(id)
    } else {
      setSelectedAgent('')
    }
  }

  function getAgentDisplayInfo(agentId: string | undefined) {
    if (!agentId || agentId === 'system') return { icon: '🤖', name: 'System' }
    const agent = AGENTS[agentId]
    if (!agent) return { icon: '🤖', name: 'System' }
    return { icon: agent.icon, name: agent.name }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h2 className="text-lg font-bold text-gray-900">💬 Chat</h2>
              {currentMessages.length > 1 && (
                <Button variant="ghost" size="sm" onClick={clearConversation}>
                  🗑️ Clear
                </Button>
              )}
            </div>
            <div className="flex space-x-1.5">
              <Badge
                variant={selectedAgent === '' ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() => { setSelectedAgent(''); setInput('') }}
              >
                Auto
              </Badge>
              {AGENT_LIST.map((agent) => (
                <Badge
                  key={agent.id}
                  variant={selectedAgent === agent.id ? 'default' : 'outline'}
                  className="cursor-pointer select-none"
                  onClick={() => handleSwitchAgent(agent.id)}
                >
                  {agent.icon} {agent.label}
                </Badge>
              ))}
            </div>
          </div>
          {selectedAgent ? (
            <p className="text-xs text-blue-600 mt-1">
              Routing all messages to: {AGENTS[selectedAgent]?.name || selectedAgent}
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">
              Auto-routing based on message content
            </p>
          )}
        </CardHeader>

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
                  <div
                    className={`text-xs mt-2 ${
                      message.role === 'user' ? 'text-blue-100' : 'text-gray-400'
                    }`}
                  >
                    {message.timestamp > 1000000000000
                      ? new Date(message.timestamp).toLocaleTimeString()
                      : ''}
                  </div>
                  {isError && lastUserMsg && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 text-xs"
                      onClick={() => handleRetry(lastUserMsg.content, selectedAgent || detectAgent(lastUserMsg.content))}
                    >
                      🔄 Retry
                    </Button>
                  )}
                </div>
              </div>
            )
          })}

          {isSending && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm text-gray-500">Agent thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        <div className="border-t p-4 bg-slate-50">
          <div className="flex space-x-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedAgent
                  ? `Message ${AGENTS[selectedAgent]?.name || selectedAgent}...`
                  : 'Type your message... (e.g., "Create a React login component")'
              }
              disabled={isSending}
              maxLength={MAX_INPUT_LENGTH}
              className="flex-1 border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm disabled:opacity-50"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isSending}
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
                onClick={() => setInput(suggestion.text)}
                className="text-xs"
                disabled={isSending}
              >
                💡 {suggestion.label}
              </Button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
