import { cn } from "@/lib/utils";

/** A placeholder block in the shape of content that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
    />
  );
}

/**
 * A loading list or section: skeleton rows shaped like what will arrive.
 *
 * Screens used to print a line of grey text ("正在載入…") and then jump when
 * the rows appeared. The rows hold the space instead. `label` is still the
 * accessible announcement — screen readers hear it through role="status", and
 * it stays in the DOM for anything that looks for it.
 */
export function LoadingRows({
  label,
  rows = 3,
  className,
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-3 p-4", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={cn("h-3.5", index % 2 === 0 ? "w-2/5" : "w-1/3")} />
            <Skeleton className={cn("h-3", index % 2 === 0 ? "w-3/4" : "w-2/3")} />
          </div>
        </div>
      ))}
    </div>
  );
}
