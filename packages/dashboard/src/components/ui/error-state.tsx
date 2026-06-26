'use client';
import { Button } from './button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Failed to load data. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50/70 px-4 py-12">
      <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs font-black tracking-[0.18em] text-red-700">ERROR</div>
      <h3 className="mb-2 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mb-6 max-w-md text-center text-sm text-gray-500">
        {message}
      </p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
