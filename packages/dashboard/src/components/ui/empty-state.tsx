'use client';
import { Button } from './button';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon = 'EMPTY',
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white/70 px-4 py-12">
      <div className="mb-4 rounded-md border border-[#ff5c1f]/25 bg-[#ff5c1f]/10 px-3 py-2 font-mono text-xs font-black tracking-[0.18em] text-[#c2410c]">{icon}</div>
      <h3 className="mb-2 text-lg font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
          {description}
        </p>
      )}
      {action && (
        <Button variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
