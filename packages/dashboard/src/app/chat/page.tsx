import { Suspense } from 'react'
import ChatContent from './ChatContent'

export default function ChatPage() {
  return (
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
              <span className="text-sm">Loading chat...</span>
            </div>
          </div>
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  )
}
