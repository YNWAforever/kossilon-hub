import { Link } from "@tanstack/react-router";
import type { AnnualReturnCase } from "@/lib/mock-data";
import { DeadlinePill } from "./deadline-pill";
import { formatDate } from "@/lib/mock-data";

export function CaseCard({ c }: { c: AnnualReturnCase }) {
  return (
    <Link
      to="/annual-returns/$id"
      params={{ id: c.id }}
      className="block rounded-lg border border-border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-semibold text-foreground">{c.companyName}</p>
        <DeadlinePill dueDate={c.dueDate} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Next: {c.nextAction}</p>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-sand text-[10px] font-semibold text-white">
            {c.ownerName.split(" ").map((n) => n[0]).join("")}
          </div>
          <span className="text-xs text-muted-foreground">{c.ownerName}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">Due {formatDate(c.dueDate)}</span>
      </div>
    </Link>
  );
}
