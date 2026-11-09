import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { decideRequestAccess, listRequestAccessQueue } from "@/features/onboarding/server-fns";
import type { RequestAccessQueueRow } from "@/features/onboarding/types";

/**
 * Admin review queue for public access requests.
 *
 * Approval/rejection only records the decision (reviewer + timestamp); creating
 * the Neon Auth invitation is a separate manual step until the invite API is
 * wired. When migration 0083 is absent (production today), the screen explains
 * the state instead of erroring.
 */
export function RequestAccessQueue() {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [rows, setRows] = useState<RequestAccessQueueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listRequestAccessQueue({ data: {} });
      setAvailable(result.available);
      setRows(result.rows);
    } catch {
      setError("未能讀取開通申請。請重新整理後再試。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: RequestAccessQueueRow, status: "approved" | "rejected") {
    setDecidingId(row.id);
    setError(null);
    try {
      const result = await decideRequestAccess({ data: { id: row.id, status } });
      if (!result.ok) {
        // Reload first (it clears the error at its start), then explain.
        await load();
        setError("此申請已由其他管理員處理，請重新整理。");
        return;
      }
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch {
      setError("未能更新申請，請重試。");
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <section aria-labelledby="request-access-queue-heading" className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 id="request-access-queue-heading" className="font-display text-base font-semibold">
            開通申請
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            公開申請佇列。批准後仍需以 Neon Auth 邀請該電郵；此處只記錄審核決定。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          重新整理
        </Button>
      </div>

      <div className="p-4">
        {loading && <p className="text-sm text-muted-foreground">正在讀取…</p>}

        {!loading && error && (
          <p role="alert" className="text-sm leading-6 text-status-red-text">
            {error}
          </p>
        )}

        {!loading && !error && !available && (
          <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs leading-5 text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>開通申請佇列尚未啟用（待資料庫遷移 0083）。目前仍以電郵處理開通申請。</span>
          </div>
        )}

        {!loading && available && rows.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Inbox className="h-4 w-4" aria-hidden="true" />
            暫無待處理申請。
          </div>
        )}

        {!loading && available && rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {row.name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {row.email}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.firm}
                      {row.team ? ` · ${row.team}` : ""}
                    </p>
                    {row.message && (
                      <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                        {row.message}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      提交於 {new Date(row.createdAt).toLocaleString("zh-HK")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decidingId === row.id}
                      onClick={() => void decide(row, "rejected")}
                    >
                      拒絕
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={decidingId === row.id}
                      onClick={() => void decide(row, "approved")}
                    >
                      批准
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
