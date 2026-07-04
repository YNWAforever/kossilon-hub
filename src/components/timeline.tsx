import { FileText, MessageSquare, Bell, DollarSign, StickyNote, ArrowRightLeft } from "lucide-react";
import type { TimelineEvent } from "@/lib/mock-data";
import { formatDateTime } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const kindMeta = {
  status:   { icon: ArrowRightLeft, color: "text-status-blue",   bg: "bg-status-blue-soft" },
  message:  { icon: MessageSquare,  color: "text-status-green",  bg: "bg-status-green-soft" },
  document: { icon: FileText,       color: "text-primary",       bg: "bg-accent" },
  payment:  { icon: DollarSign,     color: "text-status-orange", bg: "bg-status-orange-soft" },
  note:     { icon: StickyNote,     color: "text-muted-foreground", bg: "bg-muted" },
  reminder: { icon: Bell,           color: "text-status-yellow", bg: "bg-status-yellow-soft" },
} as const;

export function Timeline({ events, title = "Activity timeline" }: { events: TimelineEvent[]; title?: string }) {
  const sorted = [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
      <ol className="relative space-y-4 border-l border-border pl-5">
        {sorted.map((e) => {
          const meta = kindMeta[e.kind];
          const Icon = meta.icon;
          return (
            <li key={e.id} className="relative">
              <span className={cn("absolute -left-[26px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-card", meta.bg)}>
                <Icon className={cn("h-2.5 w-2.5", meta.color)} />
              </span>
              <p className="text-sm text-foreground">{e.text}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {e.actor} · {formatDateTime(e.at)}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
