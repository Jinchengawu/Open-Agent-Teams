'use client'

import { useSettings } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

export default function SettingsPage() {
  const { settings, updateSettings, resetSettings, isLoaded } = useSettings()
  const { showToast } = useToast()

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
    updateSettings({ ...settings })
    showToast('Settings saved successfully', 'success')
  }

  const handleReset = () => {
    if (typeof window !== 'undefined' && !confirm('Reset all settings to defaults?')) return
    resetSettings()
    showToast('Settings reset to defaults', 'info')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your agent system</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model Configuration */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Model Configuration
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model Provider
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
                Model Name
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
                API Endpoint
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
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Agent Configuration
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Tokens
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
                Temperature: {settings.temperature}
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
                <span>Precise (0)</span>
                <span>Creative (1)</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Auto-route to Agents
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
                Log Level
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
          Reset to Defaults
        </Button>
        <Button onClick={handleSave} className="bg-blue-500 hover:bg-blue-600">
          Save Settings
        </Button>
      </div>
    </div>
  )
}
