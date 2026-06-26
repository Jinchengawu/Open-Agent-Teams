'use client'

import { useSettings } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { useI18n, type Locale } from '@/lib/i18n'

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
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('settings.modelConfig')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.modelProvider')}
              </label>
              <select
                value={settings.modelProvider}
                onChange={(e) =>
                  updateSettings({ ...settings, modelProvider: e.target.value })
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
                value={settings.modelName}
                onChange={(e) =>
                  updateSettings({ ...settings, modelName: e.target.value })
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
                value={settings.apiEndpoint}
                onChange={(e) =>
                  updateSettings({ ...settings, apiEndpoint: e.target.value })
                }
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://api.deepseek.com/anthropic"
              />
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
