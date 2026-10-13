import { Link } from "@tanstack/react-router";
import { ArrowRight, DatabaseZap } from "lucide-react";

/**
 * The one empty state for a screen that reads only production data.
 *
 * Demo mode is read-only and fixture-backed (docs/adr/0001-demo-mode-is-read-only.md),
 * and several screens have no fixtures at all. Each of them used to explain that
 * in its own way — a bordered card here, a line of grey text there — so the same
 * situation looked like a different kind of failure on every screen. This says
 * it once, the same way everywhere, and points at the demo data that does exist.
 */
export function DemoUnavailable({ message }: { message: string }) {
  return (
    <section
      aria-label="示範模式未提供"
      className="flex flex-col items-center rounded-lg border border-dashed bg-card px-6 py-12 text-center"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <DatabaseZap aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="mt-4 text-base font-semibold text-foreground">示範模式未提供此資料</p>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
      <Link
        className="mt-5 inline-flex min-h-10 items-center gap-1.5 rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent"
        to="/annual-returns"
      >
        瀏覽周年申報案件
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    </section>
  );
}
