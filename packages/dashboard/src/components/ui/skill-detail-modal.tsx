'use client';
import { useEffect } from 'react';
import type { Skill } from '@/lib/types';
import { Badge } from './badge';

interface SkillDetailModalProps {
  skill: Skill | null;
  onClose: () => void;
}

export function SkillDetailModal({ skill, onClose }: SkillDetailModalProps) {
  useEffect(() => {
    if (!skill) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [skill, onClose]);

  if (!skill) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{skill.name}</h2>
            <p className="text-sm text-gray-500 mt-1">{skill.description}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <span className="text-sm font-medium text-gray-700">Category</span>
            <Badge className="ml-2">{skill.category}</Badge>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700">Agent</span>
            <Badge variant="secondary" className="ml-2">
              {skill.agent}
            </Badge>
          </div>
          {skill.tags.length > 0 && (
            <div>
              <span className="text-sm font-medium text-gray-700 block mb-2">
                Tags
              </span>
              <div className="flex flex-wrap gap-1">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
