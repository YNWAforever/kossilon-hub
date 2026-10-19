import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

/**
 * What a detail screen shows instead of its record.
 *
 * The four detail screens each improvised this. Two of them told the user a
 * case that did not exist was "temporarily unavailable, try again later",
 * one offered no way back, and one labelled its way back in English. The
 * distinction matters to the reader: "not found" means stop looking, "could
 * not load" means try again — so only the second offers a retry.
 */
export function RecordUnavailable({
  title,
  message,
  back,
  onRetry,
}: {
  title: string;
  /** Why, in words the user can act on. Never a raw server error. */
  message?: string;
  /** A link back to the list, e.g. <Link to="/clients">返回客戶</Link>. */
  back: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <main className="flex-1 space-y-4 p-4 md:p-6">
      <PageHeader eyebrow="案件與客戶" title={title} />
      {message ? (
        <p role={onRetry ? "alert" : undefined} className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {onRetry ? (
          <Button variant="primary" onClick={onRetry}>
            <RotateCw aria-hidden className="h-4 w-4" />
            重試
          </Button>
        ) : null}
        <Button asChild>{back}</Button>
      </div>
    </main>
  );
}
