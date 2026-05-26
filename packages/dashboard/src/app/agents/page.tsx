'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { useAgentHealth } from '@/hooks/useAgentHealth'
import { useSkills } from '@/hooks/useSkills'
import type { AgentStatus } from '@/lib/types'

export default function AgentsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const { agents, isLoading, error, mutate } = useAgentHealth()
  const { skills } = useSkills()
  const [selectedAgent, setSelectedAgent] = useState<AgentStatus | null>(null)

  function getAgentSkills(agentId: string) {
    return skills.filter((s) => s.agent === agentId)
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load agents"
        message="Cannot connect to agent services. Ensure agents are running and try again."
        onRetry={() => mutate()}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage and monitor your development agents
          </p>
        </div>
        <Button
          onClick={() => showToast('Add agent feature coming soon', 'info')}
        >
          + Add Agent
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : agents.length === 0 ? (
            <EmptyState
              icon="🤖"
              title="No agents found"
              description="Make sure agent services are started"
            />
          ) : (
            agents.map((agent) => (
              <Card
                key={agent.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedAgent?.id === agent.id
                    ? 'ring-2 ring-blue-500 border-blue-500'
                    : ''
                }`}
                onClick={() => setSelectedAgent(agent)}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center">
                        <span className="text-2xl">{agent.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-semibold text-gray-900">
                            {agent.name}
                          </h3>
                          <Badge
                            variant={agent.online ? 'default' : 'destructive'}
                          >
                            {agent.online ? 'Online' : 'Offline'}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {agent.label} — Port {agent.port}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="text-center">
                        <p className="font-semibold text-gray-900">
                          {agent.skillCount}
                        </p>
                        <p className="text-xs">Skills</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div>
          {selectedAgent ? (
            <Card className="sticky top-24">
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center">
                    <span className="text-xl">{selectedAgent.icon}</span>
                  </div>
                  <div>
                    <CardTitle>{selectedAgent.name}</CardTitle>
                    <p className="text-sm text-gray-500">{selectedAgent.label}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">
                      {selectedAgent.port}
                    </p>
                    <p className="text-xs text-gray-500">Port</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">
                      {selectedAgent.skillCount}
                    </p>
                    <p className="text-xs text-gray-500">Skills</p>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    Tags
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedAgent.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    Skills ({getAgentSkills(selectedAgent.id).length})
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {getAgentSkills(selectedAgent.id).length > 0
                      ? getAgentSkills(selectedAgent.id).map((skill) => (
                          <Badge key={skill.id} variant="outline">
                            {skill.name}
                          </Badge>
                        ))
                      : (
                        <span className="text-sm text-gray-400">
                          No skills loaded
                        </span>
                      )}
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <Button
                    className="w-full"
                    disabled={!selectedAgent.online}
                    onClick={() =>
                      router.push(`/chat?agent=${selectedAgent.id}`)
                    }
                  >
                    Open Chat
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => showToast('Log viewer coming soon', 'info')}
                  >
                    View Logs
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                <p className="text-3xl mb-2">👈</p>
                <p>Select an agent to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
