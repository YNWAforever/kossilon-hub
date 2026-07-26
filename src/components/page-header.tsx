import type { ReactNode } from "react";

/**
 * The page title block, and the only place the app renders an `<h1>`.
 *
 * Routes used to be split between a sticky `TopBar` and hand-rolled title
 * `<div>`s, so the same product showed two different headers — different type
 * scale, different placement, different information — depending on which screen
 * you were on. `src/components/page-header.test.tsx` keeps that from returning.
 *
 * The sticky bar also carried a search input, a help button and a notification
 * bell that were never wired to anything: the search box discarded whatever you
 * typed, the ⌘K hint had no handler, and the bell showed an unread dot on every
 * page unconditionally. They are not reproduced here. Re-add them once they do
 * something — a control that looks live and isn't is worse than no control.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  /** The section this page belongs to, matching its sidebar group. */
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
