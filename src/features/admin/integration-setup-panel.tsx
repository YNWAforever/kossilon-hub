import { AlertCircle, CheckCircle2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRuntimeCapabilities } from "@/features/operations/use-runtime-capabilities";
import { setupRows } from "@/features/operations/integration-setup";

/**
 * Admin integration setup checklist.
 *
 * Values are read from Vercel environment variables; this panel never accepts or
 * stores provider secrets. It exists so an administrator can see, in one place,
 * which bindings are missing and what approval/action each one needs.
 */
function signInMethodLabels(
  methods: {
    password: boolean;
    magicLink: boolean;
    google: boolean;
  } | null,
): string {
  if (!methods) return "未能讀取";
  const labels: string[] = [];
  if (methods.password) labels.push("密碼");
  if (methods.magicLink) labels.push("登入連結");
  if (methods.google) labels.push("Google");
  return labels.length > 0 ? labels.join(" · ") : "無";
}

export function IntegrationSetupPanel() {
  const { loaded, rows, security, refresh } = useRuntimeCapabilities();
  const setup = setupRows(rows);

  return (
    <section aria-labelledby="integration-setup-heading" className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 id="integration-setup-heading" className="font-display text-base font-semibold">
            整合設定
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted-foreground">
            狀態來自 <code>/api/capabilities</code>；只顯示綁定名稱，不會顯示或儲存任何 secret。
            實際值由負責人設定於 Vercel Environment Variables，再重新部署。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={!loaded}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          重新整理
        </Button>
      </div>

      <div className="p-4">
        {!loaded ? (
          <p className="text-sm text-muted-foreground">正在讀取整合狀態…</p>
        ) : (
          <>
            <ul className="space-y-2">
              {setup.map((item) => (
                <li key={item.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span
                      className={
                        item.configured
                          ? "inline-flex items-center gap-1 rounded-full bg-status-green-soft px-2 py-0.5 text-xs text-status-green-text"
                          : "inline-flex items-center gap-1 rounded-full bg-status-yellow-soft px-2 py-0.5 text-xs text-status-yellow-text"
                      }
                    >
                      {item.configured ? (
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {item.configured ? "已配置" : "未配置"}
                    </span>
                  </div>
                  {!item.configured ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      缺少：<code className="break-all">{item.missing.join(", ")}</code>
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.action}</p>
                  {item.secrets.length > 0 ? (
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      以下名稱屬敏感值，只可設定在 Vercel（不經此介面）：{item.secrets.join(", ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {security ? (
              <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
                <p>
                  CSP: <strong>{security.cspMode}</strong> (SECURITY_HEADERS)
                </p>
                <p>
                  登入方式: <strong>{signInMethodLabels(security.authMethods)}</strong>{" "}
                  (VITE_AUTH_METHODS)
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
