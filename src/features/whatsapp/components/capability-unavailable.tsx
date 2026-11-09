import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

/**
 * Honest screen for an unprovisioned WhatsApp deployment.
 *
 * Reached when production has no WOZTELL bindings: the capability is paused,
 * not broken. Direct URLs keep working but cannot look like a live inbox.
 */
export function WhatsAppCapabilityUnavailable({ title }: { title: string }) {
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="通訊" title={title} />
      <section className="max-w-xl rounded-lg border bg-card p-5">
        <h2 className="font-display text-base font-semibold">WhatsApp 尚未啟用</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          此部署未配置 WOZTELL 綁定，因此收件箱與自動發送已停用，而非發生故障。
          訊息不會被讀取或發送，亦不會有任何資料被刪除。
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          如試點需要 WhatsApp，請管理員配置 WOZTELL 憑證及已批核的模板後再啟用。
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/operations">查看系統狀態</Link>
        </Button>
      </section>
    </main>
  );
}
