'use client'

import { Suspense, useState } from 'react'
import ChatContent from './ChatContent'
import BroadcastView from './BroadcastView'
import MeetingView from './MeetingView'

type Mode = 'chat' | 'broadcast' | 'meeting'

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'broadcast', label: 'Broadcast', icon: '📢' },
  { id: 'meeting', label: 'Meeting', icon: '🎙️' },
]

export default function ChatPage() {
  const [mode, setMode] = useState<Mode>('chat')

  return (
    <div className="flex flex-col h-full">
      {/* 顶层模式切换 */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-slate-100 rounded-xl w-fit">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === m.id
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
            }`}
            onClick={() => setMode(m.id)}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex flex-col h-[calc(100vh-200px)]">
              <div className="bg-white rounded-xl border border-slate-200 flex-1 flex items-center justify-center">
                <div className="flex items-center space-x-2 text-gray-400">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                  <span className="text-sm">Loading...</span>
                </div>
              </div>
            </div>
          }
        >
          {/* 使用 hidden 控制显示，保持组件挂载，切换时不丢失状态和 SSE 连接 */}
          <div className={mode === 'chat' ? 'h-full' : 'hidden'}>
            <ChatContent />
          </div>
          <div className={mode === 'broadcast' ? 'h-full' : 'hidden'}>
            <BroadcastView />
          </div>
          <div className={mode === 'meeting' ? 'h-full' : 'hidden'}>
            <MeetingView />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
