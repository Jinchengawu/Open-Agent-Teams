'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { useRouter } from 'next/navigation'

interface Session {
  id: string
  title: string
  status: string
  created_at: string
  updated_at: string
}

interface Message {
  id: number
  role: string
  agent_id: string
  content: string
  created_at: string
}

export default function SessionsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const fetchSessions = () => {
    setLoading(true)
    setError('')
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data) => {
        setSessions(data.sessions || [])
        setError(data.error || '')
      })
      .catch(() => setError('Failed to fetch sessions'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchSessions() }, [])

  const viewSession = (session: Session) => {
    setSelectedSession(session)
    setLoadingMessages(true)
    fetch(`http://127.0.0.1:8400/v1/sessions/${session.id}`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages || []))
      .catch(() => {})
      .finally(() => setLoadingMessages(false))
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  if (error && sessions.length === 0) {
    return (
      <ErrorState
        title="No sessions available"
        message="Start the Gateway and send some messages to create sessions."
        onRetry={fetchSessions}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <p className="text-sm text-gray-500 mt-1">{sessions.length} conversation sessions</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {sessions.length === 0 ? (
            <EmptyState icon="💬" title="No sessions yet" description="Start a chat to create your first session." />
          ) : (
            sessions.map((session) => (
              <Card
                key={session.id}
                className={`cursor-pointer hover:shadow-md transition-all ${
                  selectedSession?.id === session.id ? 'ring-2 ring-blue-500' : ''
                }`}
                onClick={() => viewSession(session)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">
                        {session.title || 'Untitled Session'}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1 font-mono">{session.id}</p>
                    </div>
                    <div className="flex items-center space-x-3 ml-4">
                      <Badge variant={session.status === 'active' ? 'default' : 'secondary'}>
                        {session.status}
                      </Badge>
                      <span className="text-xs text-gray-400">
                        {new Date(session.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div>
          {selectedSession ? (
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle className="text-base">{selectedSession.title || 'Untitled'}</CardTitle>
                <p className="text-xs text-gray-400 font-mono">{selectedSession.id}</p>
              </CardHeader>
              <CardContent>
                <div className="flex space-x-2 mb-4">
                  <Button size="sm" onClick={() => router.push(`/chat`)}>Open in Chat</Button>
                </div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Messages ({messages.length})</h4>
                {loadingMessages ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-gray-400">No messages</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {messages.map((msg) => (
                      <div key={msg.id} className="p-2 bg-slate-50 rounded text-xs">
                        <div className="flex items-center space-x-2 mb-1">
                          <Badge variant={msg.role === 'user' ? 'default' : 'secondary'}>
                            {msg.role}
                          </Badge>
                          {msg.agent_id && msg.agent_id !== 'user' && (
                            <span className="text-gray-400">{msg.agent_id}</span>
                          )}
                        </div>
                        <p className="text-gray-600 line-clamp-2">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                <p className="text-3xl mb-2">👈</p>
                <p>Select a session to view</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
