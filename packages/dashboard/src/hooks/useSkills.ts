'use client';
import useSWR from 'swr';
import type { Skill } from '@/lib/types';

interface SkillsResponse {
  skills: Skill[];
  error?: string;
}

const fetcher = (url: string): Promise<SkillsResponse> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Failed to fetch skills');
    return r.json();
  });

export function useSkills() {
  const { data, error, isLoading } = useSWR<SkillsResponse>(
    '/api/skills',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    skills: data?.skills || [],
    error: error || data?.error,
    isLoading,
  };
}
