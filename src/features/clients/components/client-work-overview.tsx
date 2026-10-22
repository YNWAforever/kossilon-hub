import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { labelValue } from "@/lib/format-label";
import { formatDate } from "@/lib/format-date";
import { listDocumentPage, downloadDocument } from "@/features/documents/server-fns";
import { SafeDocumentPreview } from "@/features/documents/safe-preview";
import { documentSafetyOf } from "@/features/documents/safety";
import type { DocumentSummary } from "@/features/documents/repository";
import { listCompanyWorkPage } from "../company-work-server-fns";
import type { CompanyWorkItem } from "../company-work";
import { clientCaseReturnPath } from "../client-return-context";

const businessLabels = {
  annual_return: "周年申報",
  incorporation: "公司註冊",
  corporate_change: "公司變更",
};
const businessRoutes = {
  annual_return: "/annual-returns/$id",
  incorporation: "/incorporation/$id",
  corporate_change: "/corporate-changes/$id",
} as const;

function followUp(item: CompanyWorkItem) {
  if (
    item.paymentStatus &&
    ["Payment pending", "Overdue", "Not invoiced"].includes(item.paymentStatus)
  )
    return "付款待跟進；開啟案件核對金額及憑證。";
  if (item.status === "Documents pending") return "文件待收或待覆核；開啟案件核對缺件及安全狀態。";
  return `案件狀態：${labelValue(item.status)}；開啟案件核對下一步。`;
}

export function ClientWorkOverview({
  companyId,
  actorScope,
  returnTo,
}: {
  companyId: string;
  actorScope?: unknown;
  returnTo?: string;
}) {
  const query = useInfiniteQuery({
    queryKey: ["clients", companyId, "company-work", { actorScope }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listCompanyWorkPage({ data: { companyId, cursor: pageParam, limit: 100 } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const metrics = query.data?.pages[0];
  const next = items.find((item) => item.active);
  return (
    <section aria-label="客戶工作總覽" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">客戶工作總覽</h2>
      <p className="text-xs text-muted-foreground">
        只列出你獲授權讀取且已關聯此公司的案件；註冊受理中未關聯公司的案件請在公司註冊頁核對。
      </p>
      {query.isPending ? <p role="status">案件載入中…</p> : null}
      {query.isError ? (
        <p role="alert">
          案件讀取失敗；已載入資料可能過期。
          <Button onClick={() => void query.refetch()}>重試案件</Button>
        </p>
      ) : null}
      {metrics ? <p>未完成案件：{metrics.unfinished}</p> : null}
      {next ? (
        <p className="text-sm">
          首要跟進：{businessLabels[next.kind]} · {followUp(next)}
        </p>
      ) : null}
      {metrics && !query.isError && metrics.total === 0 ? <p>此授權範圍未有已關聯案件。</p> : null}
      <div className="divide-y">
        {items.map((item) => (
          <div
            key={`${item.kind}:${item.id}`}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
          >
            <div>
              <p>
                {businessLabels[item.kind]} · {labelValue(item.title)}
              </p>
              <p className="text-xs text-muted-foreground">
                {labelValue(item.status)}
                {item.dueDate ? ` · 到期日 ${formatDate(item.dueDate)}` : ""}
              </p>
            </div>
            <Link
              className="min-h-11 py-3 underline"
              aria-label={`開啟${businessLabels[item.kind]}案件 ${item.title}`}
              to={businessRoutes[item.kind]}
              params={{ id: item.id }}
              search={{ returnTo: clientCaseReturnPath(companyId, returnTo) }}
            >
              開啟案件
            </Link>
          </div>
        ))}
      </div>
      {items.some((item) => item.paymentStatus) ? (
        <div className="border-t pt-3">
          <h3 className="text-sm font-semibold">已載入案件的付款</h3>
          {items
            .filter((item) => item.paymentStatus)
            .map((item) => (
              <p key={`${item.kind}:${item.id}`} className="text-sm">
                {businessLabels[item.kind]} {item.title} · {labelValue(item.paymentStatus)}
                {item.amount !== null ? ` · HKD ${item.amount}` : ""}
              </p>
            ))}
        </div>
      ) : null}
      {query.hasNextPage ? (
        <Button
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多客戶案件
        </Button>
      ) : null}
    </section>
  );
}

function blockedReason(document: DocumentSummary): string | null {
  if (!document.currentVersionId || document.availability === "metadata_only")
    return "欠缺當前版本或完整上載來源，不能預覽或下載。";
  if (document.availability === "missing_object") return "找不到已核對的儲存物件，不能預覽或下載。";
  const safety = documentSafetyOf(document);
  if (safety === "unsafe") return "掃描拒絕，不能預覽或下載。";
  if (safety === "pending") return "文件正在隔離，等待掃描；不能預覽或下載。";
  if (safety === "unknown") return "當前版本的來源、掃描或校驗證據未核實，不能預覽或下載。";
  return null;
}

export function ClientDocuments({
  companyId,
  actorScope,
  returnTo,
}: {
  companyId: string;
  actorScope?: unknown;
  returnTo?: string;
}) {
  const query = useInfiniteQuery({
    queryKey: ["documents", "client", companyId, { actorScope }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listDocumentPage({ data: { companyId, cursor: pageParam, limit: 100 } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const documents = query.data?.pages.flatMap((page) => page.documents) ?? [];
  return (
    <section aria-label="客戶文件" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">文件</h2>
      <p className="text-xs text-muted-foreground">
        文件登記及業務覆核不代表檔案安全。預覽及下載會重新核對授權、當前版本、掃描與實際檔案；儲存物件尚未預先核對。
      </p>
      {query.isPending ? <p role="status">文件載入中…</p> : null}
      {query.isError ? (
        <p role="alert">
          文件讀取失敗；已載入資料可能過期。
          <Button onClick={() => void query.refetch()}>重試文件</Button>
        </p>
      ) : null}
      {query.isSuccess && !documents.length ? <p>此授權範圍未有文件紀錄。</p> : null}
      <div className="divide-y">
        {documents.map((document) => (
          <div key={document.id} className="space-y-2 py-3 text-sm">
            <p className="break-all font-medium">{document.fileName}</p>
            <p className="break-all text-xs text-muted-foreground">
              當前版本：{document.currentVersionId ?? "未有版本"} · 覆核：
              {document.reviewStatus === "verified"
                ? "已核實"
                : document.reviewStatus === "rejected"
                  ? "已退回"
                  : "待覆核"}
            </p>
            {document.caseId ? (
              <Link
                className="underline"
                to="/annual-returns/$id"
                params={{ id: document.caseId }}
                search={{ returnTo: clientCaseReturnPath(companyId, returnTo) }}
              >
                開啟文件所屬案件
              </Link>
            ) : (
              <p>未關聯案件</p>
            )}
            {blockedReason(document) ? (
              <p>{blockedReason(document)}</p>
            ) : (
              <ClientFileActions
                key={`${document.id}:${document.currentVersionId}`}
                document={document}
              />
            )}
          </div>
        ))}
      </div>
      {query.hasNextPage ? (
        <Button
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多客戶文件
        </Button>
      ) : null}
    </section>
  );
}

function ClientFileActions({ document }: { document: DocumentSummary }) {
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  async function download() {
    setPending(true);
    setError(false);
    try {
      const response = await downloadDocument({
        data: { documentId: document.id, expectedVersionId: document.currentVersionId! },
      });
      if (!response.ok) throw new Error("Download unavailable");
      const href = URL.createObjectURL(await response.blob());
      try {
        const anchor = window.document.createElement("a");
        anchor.href = href;
        anchor.download = document.fileName;
        anchor.click();
      } finally {
        URL.revokeObjectURL(href);
      }
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <SafeDocumentPreview
        document={document}
        label={`預覽 ${document.fileName}`}
        title={`文件預覽 ${document.fileName}`}
      />
      <Button disabled={pending} onClick={() => void download()}>
        下載 {document.fileName}
      </Button>
      {error ? <p role="alert">下載未能完成或版本已更新，請重新載入文件。</p> : null}
    </div>
  );
}
