'use client';
import { useState, useEffect, useCallback } from 'react';
import type { AppSettings, ModelProfile } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/constants';

const STORAGE_KEY = 'dev-agent-settings';

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      const profiles: ModelProfile[] = Array.isArray(merged.modelProfiles) && merged.modelProfiles.length > 0
        ? merged.modelProfiles
        : [
            {
              id: 'default-model',
              name: merged.modelName || 'Default Model',
              provider: merged.modelProvider || DEFAULT_SETTINGS.modelProvider,
              modelName: merged.modelName || DEFAULT_SETTINGS.modelName,
              apiEndpoint: merged.apiEndpoint || DEFAULT_SETTINGS.apiEndpoint,
              apiKey: '',
            },
          ];
      const defaultModelProfileId = profiles.some((profile: ModelProfile) => profile.id === merged.defaultModelProfileId)
        ? merged.defaultModelProfileId
        : profiles[0].id;
      return {
        ...merged,
        modelProfiles: profiles,
        defaultModelProfileId,
        agentModelAssignments: merged.agentModelAssignments && typeof merged.agentModelAssignments === 'object'
          ? merged.agentModelAssignments
          : {},
      };
    }
  } catch {
    // corrupted data, use defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setIsLoaded(true);
    fetch('/api/settings', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { settings?: AppSettings } | null) => {
        if (!data?.settings) return;
        setSettings(data.settings);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.settings));
      })
      .catch(() => {
        // Local browser settings remain usable when the API is unavailable.
      });
  }, []);

  const updateSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: newSettings }),
      }).catch(() => {
        // Keep UI responsive; the next save can retry persistence.
      });
    }
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: DEFAULT_SETTINGS }),
      }).catch(() => {
        // ignore
      });
    }
  }, []);

  return { settings, updateSettings, resetSettings, isLoaded };
}
