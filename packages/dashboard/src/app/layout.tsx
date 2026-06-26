import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { NavBar } from '@/components/NavBar'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/lib/i18n'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Open-Agent-Teams Console',
  description: 'Agent team coordination console',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <I18nProvider>
          <ToastProvider>
            <div className="dev-shell flex min-h-screen flex-col">
              <NavBar />
              <main className="mx-auto w-full max-w-[1540px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
                {children}
              </main>
              <footer className="mt-auto border-t border-slate-200 bg-white/72 backdrop-blur-xl">
                <div className="mx-auto max-w-[1540px] px-4 py-4 sm:px-6 lg:px-8">
                  <div className="flex flex-col gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <p>Open-Agent-Teams Console v0.1.0</p>
                    <p>Gateway / Hermes / Coordination Layer</p>
                  </div>
                </div>
              </footer>
            </div>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
