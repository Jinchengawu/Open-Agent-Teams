'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type ConfirmTone = 'danger' | 'warning' | 'neutral'

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
}

interface ConfirmRequest extends Required<ConfirmOptions> {
  resolve: (confirmed: boolean) => void
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

const toneStyles: Record<ConfirmTone, string> = {
  danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  warning: 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-500',
  neutral: 'bg-[#111820] hover:bg-slate-800 focus:ring-slate-500',
}

const toneBadges: Record<ConfirmTone, string> = {
  danger: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    return async (options: ConfirmOptions) => {
      if (typeof window === 'undefined') return false
      return window.confirm(options.description || options.title)
    }
  }
  return ctx.confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setRequest({
        title: options.title,
        description: options.description || '',
        confirmLabel: options.confirmLabel || '确认',
        cancelLabel: options.cancelLabel || '取消',
        tone: options.tone || 'neutral',
        resolve,
      })
    })
  }, [])

  const close = useCallback((confirmed: boolean) => {
    setRequest((current) => {
      current?.resolve(confirmed)
      return null
    })
  }, [])

  useEffect(() => {
    if (!request) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, request])

  const value = useMemo(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="w-full max-w-[420px] rounded-xl border border-slate-200 bg-white p-5 shadow-[0_32px_90px_rgba(15,23,42,0.22)]"
          >
            <div className={cn('mb-4 inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]', toneBadges[request.tone])}>
              High Risk Action
            </div>
            <h2 id="confirm-dialog-title" className="text-xl font-black text-[#111820]">
              {request.title}
            </h2>
            {request.description && (
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {request.description}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                onClick={() => close(false)}
              >
                {request.cancelLabel}
              </button>
              <button
                type="button"
                className={cn('rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2', toneStyles[request.tone])}
                onClick={() => close(true)}
                autoFocus
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
