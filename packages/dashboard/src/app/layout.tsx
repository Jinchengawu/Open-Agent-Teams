import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { NavBar } from '@/components/NavBar'
import { ToastProvider } from '@/components/ui/toast'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'DEV-Agent-Teams Dashboard',
  description: 'Developer Multi-Agent System Management Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ToastProvider>
          <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
            <NavBar />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
              {children}
            </main>
            <footer className="bg-white/50 border-t border-slate-200 mt-auto">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex justify-between items-center text-sm text-gray-500">
                  <p>DEV-Agent-Teams v0.1.0</p>
                  <p>Powered by OpenClaw + Hermes</p>
                </div>
              </div>
            </footer>
          </div>
        </ToastProvider>
      </body>
    </html>
  )
}
