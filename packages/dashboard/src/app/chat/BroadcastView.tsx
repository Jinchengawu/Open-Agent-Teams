'use client'

import { useState, useRef, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { AGENTS, AGENT_LIST } from '@/lib/agents'
import type { ChatMessage } from '@/lib/types'

interface BroadcastRecord {
  id: string
  message: string
  timestamp: number
  responses: { agent: string; content: string; error?: boolean }[]
}

const STORAGE_KEY = 'open-agent-teams-broadcast-v1'

function loadHistory(): BroadcastRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

function saveHistory(records: BroadcastRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-20)))
}

export default function BroadcastView() {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<BroadcastRecord[]>(() => loadHistory())
  const [activeRecord, setActiveRecord] = useState<string | null>(null)
  const { showToast } = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    saveHistory(history)
  }, [history])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeRecord, history])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || sending) return
    setInput('')
    setSending(true)

    const record: BroadcastRecord = {
      id: `broadcast-${Date.now()}`,
      message: msg,
      timestamp: Date.now(),
      responses: [],
    }

    try {
      const res = await fetch('/api/collab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          agents: AGENT_LIST.map(a => a.id),
          mode: 'broadcast',
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // 解析响应 — 支持两种格式
      if (data.responses) {
        record.responses = data.responses
      } else {
        // 单响应格式（Gateway team 模式）
        record.responses = [{
          agent: data.agent || 'team',
          content: data.content || 'No response',
        }]
      }
    } catch (e) {
      record.responses = [{
        agent: 'system',
        content: `Error: ${e instanceof Error ? e.message : 'unknown'}`,
        error: true,
      }]
      showToast(`Broadcast failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error')
    }

    setHistory(prev => [...prev, record])
    setActiveRecord(record.id)
    setSending(false)
  }

  const current = activeRecord ? history.find(r => r.id === activeRecord) : null

  return (
    <div className="flex h-[calc(100vh-200px)] gap-4">
      {/* 左侧：广播历史 */}
      <div className="w-64 flex flex-col border rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50">
          <h3 className="text-sm font-semibold text-gray-700">📢 广播记录</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">
              暂无广播记录
            </div>
          ) : (
            [...history].reverse().map(record => (
              <button
                key={record.id}
                className={`w-full text-left px-4 py-3 border-b hover:bg-blue-50 transition-colors ${
                  activeRecord === record.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                }`}
                onClick={() => setActiveRecord(record.id)}
              >
                <div className="text-sm font-medium text-gray-800 truncate">
                  {record.message}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(record.timestamp).toLocaleString()} · {record.responses.length} 响应
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 右侧：输入 + 响应 */}
      <div className="flex-1 flex flex-col">
        {/* 输入区域 */}
        <Card className="mb-4">
          <div className="p-4">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="输入消息广播给所有 Agent..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                disabled={sending}
                maxLength={10000}
              />
              <Button
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="bg-blue-500 hover:bg-blue-600"
              >
                {sending ? '⏳ 发送中...' : '📢 广播'}
              </Button>
            </div>
          </div>
        </Card>

        {/* 响应区域 */}
        <Card className="flex-1 overflow-hidden">
          <CardContent className="h-full overflow-y-auto p-4">
            {!current ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                <div className="text-center">
                  <div className="text-4xl mb-2">📢</div>
                  <p>输入消息并广播，所有 Agent 将同时响应</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 用户消息 */}
                <div className="flex justify-end">
                  <div className="max-w-[70%] bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-2xl p-4 shadow-lg">
                    <div className="text-sm opacity-80 mb-1">📢 广播消息</div>
                    <div className="whitespace-pre-wrap">{current.message}</div>
                  </div>
                </div>

                {/* Agent 响应网格 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {current.responses.map((r, i) => {
                    const agent = AGENTS[r.agent]
                    return (
                      <div
                        key={`${current.id}-${i}`}
                        className={`border rounded-xl p-4 ${
                          r.error ? 'bg-red-50 border-red-200' : 'bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                          <span className="text-lg">{agent?.icon || '🤖'}</span>
                          <span className="font-medium text-sm">
                            {agent?.name || r.agent}
                          </span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-gray-700">
                          {r.content}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div ref={scrollRef} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
