'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { NAV_ITEMS } from '@/lib/constants';
import { useAgentHealth } from '@/hooks/useAgentHealth';
import { useI18n } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function NavBar() {
  const pathname = usePathname();
  const { stats } = useAgentHealth();
  const { t } = useI18n();
  const statusTone = {
    checking: {
      container: 'border-sky-200 bg-sky-50',
      dot: 'bg-sky-500 animate-pulse',
      text: 'text-sky-700',
      label: t('health.checking', 'Checking agents...'),
    },
    online: {
      container: 'border-emerald-200 bg-emerald-50',
      dot: 'bg-emerald-500 animate-pulse',
      text: 'text-emerald-700',
      label: `${stats.onlineCount}/${stats.totalAgents} ${t('health.agentsOnline', 'Agents Online')}`,
    },
    degraded: {
      container: 'border-amber-200 bg-amber-50',
      dot: 'bg-amber-500 animate-pulse',
      text: 'text-amber-700',
      label: `${stats.onlineCount}/${stats.totalAgents} ${t('health.agentsOnline', 'Agents Online')}`,
    },
    stale: {
      container: 'border-slate-200 bg-slate-50',
      dot: 'bg-slate-400',
      text: 'text-slate-700',
      label: `${stats.onlineCount}/${stats.totalAgents} ${t('health.lastKnown', 'Last known')}`,
    },
    offline: {
      container: 'border-red-200 bg-red-50',
      dot: 'bg-red-500',
      text: 'text-red-700',
      label: stats.gatewayOnline === false ? 'Gateway offline' : t('health.noAgents', 'No agents online'),
    },
  }[stats.status];

  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-[#dbe6f5] bg-white/92 backdrop-blur-2xl">
        <div className="flex h-16 items-center gap-4 px-4 lg:pl-5 lg:pr-6">
          <Link href="/" className="flex min-w-[220px] items-center gap-3">
            <div className="brand-cube">
              <span>DT</span>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-black tracking-tight text-[#111827]">Open-Agent-Teams</h1>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">{t('nav.brandSubtitle')}</p>
            </div>
          </Link>

          <button className="hidden h-10 min-w-[180px] items-center justify-between rounded-lg border border-[#dbe6f5] bg-white px-4 text-sm font-bold text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:flex">
            <span>通用 Agent 团队框架</span>
            <span className="text-[#64748b]">⌄</span>
          </button>

          <div className="mx-auto hidden h-10 max-w-[560px] flex-1 items-center gap-2 rounded-lg border border-[#dbe6f5] bg-white px-3 text-sm text-[#94a3b8] shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:flex">
            <span className="text-[#334155]">⌕</span>
            <span className="truncate">搜索任务、文档、Agent 或输入指令...</span>
            <kbd className="ml-auto rounded border border-[#dbe6f5] bg-[#f8fbff] px-1.5 py-0.5 text-[11px] font-bold text-[#64748b]">⌘ K</kbd>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div
              className={`hidden items-center gap-2 rounded-lg border px-3 py-2 md:flex ${statusTone.container}`}
              title={stats.statusReason}
            >
              <div className={`h-2 w-2 rounded-full ${statusTone.dot}`} />
              <span className={`whitespace-nowrap text-xs font-black ${statusTone.text}`}>
                {statusTone.label}
              </span>
            </div>
            <div className="hidden items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 md:flex">
              <span>♢</span>
              <span>E2E Gate&nbsp; PASS</span>
            </div>
            <button className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-[#dbe6f5] bg-white text-[#334155] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
              ♡
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">3</span>
            </button>
            <LanguageSwitcher />
            <button className="hidden h-10 items-center gap-2 rounded-lg border border-[#dbe6f5] bg-white px-2 pr-3 text-sm font-bold text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:flex">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eaf2ff]">👨‍💼</span>
              <span>张明</span>
              <span className="text-[#64748b]">⌄</span>
            </button>
          </div>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-[180px] flex-col border-r border-[#dbe6f5] bg-white/90 backdrop-blur-2xl lg:flex">
        <nav className="flex-1 space-y-1 px-3 py-5">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold transition ${
                  isActive
                    ? 'bg-[#eaf2ff] text-[#176bff] shadow-[inset_3px_0_0_#176bff]'
                    : 'text-[#30415f] hover:bg-[#f4f7fb] hover:text-[#176bff]'
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center text-base">{item.icon}</span>
                <span>{t(item.labelKey, item.label)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-[#dbe6f5] p-3">
          <div className="rounded-lg border border-[#dbe6f5] bg-[#f8fbff] p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm">👩‍💼</span>
              <div>
                <p className="text-xs font-black text-[#0f172a]">需要帮助?</p>
                <p className="text-[11px] text-[#64748b]">查看快速上手指南</p>
              </div>
            </div>
          </div>
          <button className="mt-3 flex h-10 w-full items-center gap-2 rounded-lg px-2 text-sm font-bold text-[#64748b] hover:bg-[#f4f7fb]">
            ‹ 收起
          </button>
        </div>
      </aside>

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-[#dbe6f5] bg-white/95 p-1 backdrop-blur-xl lg:hidden">
        {NAV_ITEMS.slice(0, 6).map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-bold ${isActive ? 'bg-[#eaf2ff] text-[#176bff]' : 'text-[#64748b]'}`}
            >
              <span>{item.icon}</span>
              <span className="max-w-full truncate">{t(item.labelKey, item.label)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
