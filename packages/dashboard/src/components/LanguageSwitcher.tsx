'use client';

import { useI18n } from '@/lib/i18n';

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="flex rounded-md border border-slate-200 bg-white/70 p-1 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
      {(['zh', 'en'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          className={`rounded px-2.5 py-1 transition ${
            locale === option
              ? 'bg-[#111820] text-white'
              : 'hover:bg-slate-100 hover:text-[#111820]'
          }`}
          aria-pressed={locale === option}
          data-testid={`language-switch-${option}`}
        >
          {option === 'zh' ? '中' : 'EN'}
        </button>
      ))}
    </div>
  );
}
