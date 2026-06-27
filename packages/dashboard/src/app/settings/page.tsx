'use client'

import { useSettings } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { useI18n, type Locale } from '@/lib/i18n'
import type { ModelProfile } from '@/lib/types'

export default function SettingsPage() {
  const { settings, updateSettings, resetSettings, isLoaded } = useSettings()
  const { showToast } = useToast()
  const { locale, setLocale, t } = useI18n()

  if (!isLoaded) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-32" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-gray-100 rounded-lg" />
          <div className="h-64 bg-gray-100 rounded-lg" />
        </div>
      </div>
    )
  }

  const handleSave = () => {
    updateSettings({ ...settings, language: locale })
    showToast(t('settings.saved'), 'success')
  }

  const handleReset = () => {
    if (typeof window !== 'undefined' && !confirm(t('settings.resetConfirm'))) return
    resetSettings()
    setLocale('zh')
    showToast(t('settings.resetDone'), 'info')
  }

  const handleLanguageChange = (nextLocale: Locale) => {
    setLocale(nextLocale)
    updateSettings({ ...settings, language: nextLocale })
  }

  const activeModelProfile =
    settings.modelProfiles.find((profile) => profile.id === settings.defaultModelProfileId) ||
    settings.modelProfiles[0]

  const updateModelProfile = (id: string, patch: Partial<ModelProfile>) => {
    const modelProfiles = settings.modelProfiles.map((profile) =>
      profile.id === id ? { ...profile, ...patch } : profile
    )
    const nextDefault = modelProfiles.find((profile) => profile.id === settings.defaultModelProfileId) || modelProfiles[0]
    updateSettings({
      ...settings,
      modelProfiles,
      modelProvider: nextDefault?.provider || settings.modelProvider,
      modelName: nextDefault?.modelName || settings.modelName,
      apiEndpoint: nextDefault?.apiEndpoint || settings.apiEndpoint,
    })
  }

  const addModelProfile = () => {
    const id = `model-${Date.now()}`
    const nextProfile: ModelProfile = {
      id,
      name: `Model ${settings.modelProfiles.length + 1}`,
      provider: settings.modelProvider || 'openai',
      modelName: '',
      apiEndpoint: '',
      apiKey: '',
    }
    updateSettings({
      ...settings,
      modelProfiles: [...settings.modelProfiles, nextProfile],
      defaultModelProfileId: settings.defaultModelProfileId || id,
    })
  }

  const removeModelProfile = (id: string) => {
    if (settings.modelProfiles.length <= 1) {
      showToast('至少保留一个模型配置', 'info')
      return
    }
    const modelProfiles = settings.modelProfiles.filter((profile) => profile.id !== id)
    const defaultModelProfileId = settings.defaultModelProfileId === id
      ? modelProfiles[0].id
      : settings.defaultModelProfileId
    const agentModelAssignments = Object.fromEntries(
      Object.entries(settings.agentModelAssignments || {}).filter(([, modelId]) => modelId !== id)
    )
    const nextDefault = modelProfiles.find((profile) => profile.id === defaultModelProfileId) || modelProfiles[0]
    updateSettings({
      ...settings,
      modelProfiles,
      defaultModelProfileId,
      agentModelAssignments,
      modelProvider: nextDefault.provider,
      modelName: nextDefault.modelName,
      apiEndpoint: nextDefault.apiEndpoint,
    })
  }

  const setDefaultModelProfile = (id: string) => {
    const profile = settings.modelProfiles.find((item) => item.id === id)
    if (!profile) return
    updateSettings({
      ...settings,
      defaultModelProfileId: id,
      modelProvider: profile.provider,
      modelName: profile.modelName,
      apiEndpoint: profile.apiEndpoint,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#007f96]">Settings / I18N</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('settings.subtitle')}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white/76 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.08)]">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t('settings.languageConfig')}
        </h2>
        <div className="grid gap-4 md:grid-cols-[1fr_260px] md:items-center">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('settings.language')}
            </label>
            <p className="text-sm text-gray-500">{t('settings.languageHint')}</p>
          </div>
          <select
            value={locale}
            onChange={(event) => handleLanguageChange(event.target.value as Locale)}
            className="w-full rounded-lg border border-slate-200 bg-white/80 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#007f96]/30"
            data-testid="settings-language-select"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model Configuration */}
        <div className="rounded-lg border border-slate-200 bg-white/76 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {t('settings.modelConfig')}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                维护可被 Agent 选择的模型注册表；默认模型会作为新 Agent 的初始配置。
              </p>
            </div>
            <Button variant="outline" onClick={addModelProfile}>添加模型</Button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                默认模型
              </label>
              <select
                value={settings.defaultModelProfileId}
                onChange={(event) => setDefaultModelProfile(event.target.value)}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="settings-default-model-profile"
              >
                {settings.modelProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name || profile.modelName || profile.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.modelProvider')}
              </label>
              <select
                value={activeModelProfile?.provider || settings.modelProvider}
                onChange={(e) =>
                  activeModelProfile && updateModelProfile(activeModelProfile.id, { provider: e.target.value })
                }
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.modelName')}
              </label>
              <input
                type="text"
                value={activeModelProfile?.modelName || settings.modelName}
                onChange={(e) =>
                  activeModelProfile && updateModelProfile(activeModelProfile.id, { modelName: e.target.value, name: activeModelProfile.name || e.target.value })
                }
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. deepseek-v4-pro[1m]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.apiEndpoint')}
              </label>
              <input
                type="text"
                value={activeModelProfile?.apiEndpoint || settings.apiEndpoint}
                onChange={(e) =>
                  activeModelProfile && updateModelProfile(activeModelProfile.id, { apiEndpoint: e.target.value })
                }
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://api.deepseek.com/anthropic"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Model Registry</div>
              {settings.modelProfiles.map((profile) => (
                <div key={profile.id} className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={profile.name}
                    onChange={(event) => updateModelProfile(profile.id, { name: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"
                    placeholder="显示名称"
                  />
                  <input
                    value={profile.modelName}
                    onChange={(event) => updateModelProfile(profile.id, { modelName: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"
                    placeholder="模型名称"
                  />
                  <Button
                    variant="outline"
                    onClick={() => removeModelProfile(profile.id)}
                    className="border-red-200 text-red-600 hover:bg-red-50"
                  >
                    删除
                  </Button>
                  <input
                    value={profile.apiEndpoint}
                    onChange={(event) => updateModelProfile(profile.id, { apiEndpoint: event.target.value })}
                    className="md:col-span-2 h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"
                    placeholder="API Endpoint"
                  />
                  <input
                    value={profile.apiKey || ''}
                    onChange={(event) => updateModelProfile(profile.id, { apiKey: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"
                    placeholder="API Key，可选"
                    type="password"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent Configuration */}
        <div className="rounded-lg border border-slate-200 bg-white/76 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.08)]">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('settings.agentConfig')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.maxTokens')}
              </label>
              <input
                type="number"
                value={settings.maxTokens}
                onChange={(e) => {
                  const val = parseInt(e.target.value)
                  if (isNaN(val) || val < 1) return
                  updateSettings({ ...settings, maxTokens: val })
                }}
                min={1}
                max={32000}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.temperature')}: {settings.temperature}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.temperature}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    temperature: parseFloat(e.target.value),
                  })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{t('settings.precise')} (0)</span>
                <span>{t('settings.creative')} (1)</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                {t('settings.autoRoute')}
              </label>
              <button
                onClick={() =>
                  updateSettings({ ...settings, autoRoute: !settings.autoRoute })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.autoRoute ? 'bg-blue-500' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.autoRoute ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.logLevel')}
              </label>
              <select
                value={settings.logLevel}
                onChange={(e) =>
                  updateSettings({ ...settings, logLevel: e.target.value })
                }
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end space-x-3">
        <Button variant="outline" onClick={handleReset}>
          {t('settings.resetDefaults')}
        </Button>
        <Button onClick={handleSave} className="bg-blue-500 hover:bg-blue-600">
          {t('settings.saveSettings')}
        </Button>
      </div>
    </div>
  )
}
