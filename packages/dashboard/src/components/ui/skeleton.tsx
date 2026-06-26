import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-slate-200/80', className)}
      {...props}
    />
  );
}

function SkeletonCard() {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white/70 p-6">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}

function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonCard, SkeletonText };
