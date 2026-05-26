'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { NAV_ITEMS } from '@/lib/constants';
import { useAgentHealth } from '@/hooks/useAgentHealth';

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { stats } = useAgentHealth();
  const systemOnline = stats.onlineCount > 0;

  return (
    <>
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-white text-xl">🧠</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  DEV-Agent-Teams
                </h1>
                <p className="text-xs text-gray-500">OpenClaw x Hermes</p>
              </div>
            </Link>
            <div className="flex items-center space-x-4">
              <div
                className={`hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full ${
                  systemOnline ? 'bg-green-50' : 'bg-red-50'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    systemOnline
                      ? 'bg-green-500 animate-pulse'
                      : 'bg-red-500'
                  }`}
                ></div>
                <span
                  className={`text-sm font-medium ${
                    systemOnline ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {systemOnline
                    ? `${stats.onlineCount} Agents Online`
                    : 'No Agents'}
                </span>
              </div>
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <svg
                  className="w-5 h-5 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
              </button>
              <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                Z
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white/50 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-3 text-sm font-medium rounded-t-lg transition-colors ${
                    isActive
                      ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-500'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {item.icon} {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
