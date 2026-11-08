import { ArrowLeft, ArrowRight } from "lucide-react";

import { PRODUCT_NAME } from "@/lib/brand";

/**
 * Public `/demo` landing for a deployment that has the fixture demo disabled.
 * It must not look like a broken app: say the demo is not enabled here and point
 * at the two real ways forward (request access or read the product page).
 */
export function DemoEntryPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto max-w-xl">
        <a
          className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
          href="/"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          返回 ComSec OS
        </a>

        <section className="mt-8 rounded-lg border border-border bg-card p-8 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {PRODUCT_NAME}
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold">示範工作空間</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            此部署未啟用公開示範。示範只會載入模擬資料，不會建立或修改任何客戶資料。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              href="/request-access"
            >
              申請工作空間
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              href="/"
            >
              了解產品
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
