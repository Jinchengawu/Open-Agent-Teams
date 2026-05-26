'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { SkillDetailModal } from '@/components/ui/skill-detail-modal'
import { useSkills } from '@/hooks/useSkills'
import { SKILL_CATEGORIES } from '@/lib/constants'
import type { Skill } from '@/lib/types'

export default function SkillsPage() {
  const { skills, isLoading, error } = useSkills()
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)

  const activeCategories = [
    { id: 'all', label: 'All', icon: '📚' },
    ...SKILL_CATEGORIES.filter((cat) =>
      skills.some((s) => s.category === cat.key)
    ).map((cat) => ({ id: cat.key, label: cat.label, icon: cat.icon })),
  ].map((cat) => ({
    ...cat,
    count:
      cat.id === 'all'
        ? skills.length
        : skills.filter((s) => s.category === cat.id).length,
  }))

  const filteredSkills = skills.filter((skill) => {
    const matchesCategory =
      selectedCategory === 'all' || skill.category === selectedCategory
    const matchesSearch =
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  const categoryVariant = (category: string) => {
    const map: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
      frontend: 'default',
      backend: 'secondary',
      testing: 'outline',
      devops: 'destructive',
    }
    return map[category] || 'outline'
  }

  const categoryIcon = (category: string) => {
    const map: Record<string, string> = {
      frontend: '🎨',
      backend: '⚙️',
      testing: '🧪',
      devops: '🚀',
      database: '🗄️',
      security: '🔒',
    }
    return map[category] || '📦'
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load skills"
        message="Could not read the skills directory. Check that the skills folder exists."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Skills</h1>
          <p className="text-gray-500 mt-1">
            {skills.length} skills available across all agents
          </p>
        </div>
      </div>

      <div className="relative flex-1">
        <input
          type="text"
          placeholder="Search skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full border border-slate-300 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm"
        />
        <svg
          className="absolute left-3 top-3.5 h-5 w-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      <div className="flex space-x-2 overflow-x-auto pb-2">
        {activeCategories.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              selectedCategory === category.id
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-slate-200'
            }`}
          >
            <span>{category.icon}</span>
            <span>{category.label}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs ${
                selectedCategory === category.id
                  ? 'bg-blue-500'
                  : 'bg-gray-100'
              }`}
            >
              {category.count}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filteredSkills.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <Card
              key={skill.id}
              className="hover:shadow-lg transition-all cursor-pointer"
              onClick={() => setSelectedSkill(skill)}
            >
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-gray-900">{skill.name}</h3>
                  <Badge variant={categoryVariant(skill.category)}>
                    {skill.category}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  {skill.description}
                </p>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500 flex items-center space-x-1">
                    <span>{categoryIcon(skill.category)}</span>
                    <span>{skill.agent} agent</span>
                  </span>
                  <span className="text-xs text-blue-500 font-medium">
                    View →
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🔍"
          title="No skills found"
          description="No skills match your current search criteria."
        />
      )}

      <SkillDetailModal
        skill={selectedSkill}
        onClose={() => setSelectedSkill(null)}
      />
    </div>
  )
}
