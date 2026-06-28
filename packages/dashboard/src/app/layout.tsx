import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { NavBar } from '@/components/NavBar'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
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
            <ConfirmProvider>
              <div className="dev-shell min-h-screen">
                <NavBar />
                <main className="w-full px-4 pb-6 pt-20 sm:px-6 lg:pl-[204px] lg:pr-6">
                  {children}
                </main>
              </div>
            </ConfirmProvider>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
