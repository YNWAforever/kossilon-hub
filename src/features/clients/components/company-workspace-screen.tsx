import { useQuery } from "@tanstack/react-query";
import type { AuthenticatedActor } from "@/features/auth/types";
import { useRetainedPage } from "@/lib/use-retained-page";
import { PageHeader } from "@/components/page-header";
import { ProductionClientDetail } from "./production-client-detail";
import { companyWorkspaceReturnPath } from "../company-workspace-navigation";
import { COMPANY_WORKSPACE_TABS, type CompanyWorkspaceSearch } from "../company-workspace-types";
import {
  getCompanyWorkspaceSummary,
  listCompanyWorkspaceCases,
  listCompanyWorkspaceDocuments,
  listCompanyWorkspacePayments,
  listCompanyWorkspaceActivity,
} from "../company-workspace-server-fns";
const labels = {
  overview: "總覽",
  cases: "工作",
  documents: "文件",
  payments: "款項",
  activity: "活動",
};
export function CompanyWorkspaceScreen({
  companyId,
  actor,
  search,
  onSearchChange,
}: {
  companyId: string;
  actor?: AuthenticatedActor;
  search: CompanyWorkspaceSearch;
  onSearchChange: (s: CompanyWorkspaceSearch) => void;
}) {
  const input = {
    companyId,
    q: search.q,
    cursor: search.cursor,
    history: search.history,
    kind: search.kind,
    eventType: search.eventType,
    limit: 50,
  };
  const summary = useQuery({
    queryKey: ["company-workspace", actor, companyId, "summary"],
    queryFn: () => getCompanyWorkspaceSummary({ data: { companyId } }),
    retry: false,
  });
  const cases = useQuery({
    queryKey: ["company-workspace", actor, "cases", input],
    queryFn: () => listCompanyWorkspaceCases({ data: input }),
    enabled: search.tab === "cases",
    retry: false,
  });
  const documents = useQuery({
    queryKey: ["company-workspace", actor, "documents", input],
    queryFn: () => listCompanyWorkspaceDocuments({ data: input }),
    enabled: search.tab === "documents",
    retry: false,
  });
  const payments = useQuery({
    queryKey: ["company-workspace", actor, "payments", input],
    queryFn: () => listCompanyWorkspacePayments({ data: input }),
    enabled: search.tab === "payments",
    retry: false,
  });
  const activity = useQuery({
    queryKey: ["company-workspace", actor, "activity", input],
    queryFn: () => listCompanyWorkspaceActivity({ data: input }),
    enabled: search.tab === "activity",
    retry: false,
  });
  const key = JSON.stringify([actor, companyId, { ...search, cursor: undefined }]);
  const cp = useRetainedPage(key, cases.data),
    dp = useRetainedPage(key, documents.data),
    pp = useRetainedPage(key, payments.data),
    ap = useRetainedPage(key, activity.data);
  const page =
    search.tab === "cases"
      ? cp
      : search.tab === "documents"
        ? dp
        : search.tab === "payments"
          ? pp
          : ap;
  const query =
    search.tab === "cases"
      ? cases
      : search.tab === "documents"
        ? documents
        : search.tab === "payments"
          ? payments
          : search.tab === "activity"
            ? activity
            : summary;
  const change = (patch: Partial<CompanyWorkspaceSearch>) =>
    onSearchChange({ ...search, ...patch, cursor: undefined });
  const returnTo = companyWorkspaceReturnPath(companyId, search);
  const caseHref = (href: string) => href + "?" + new URLSearchParams({ returnTo });
  const field = "min-h-11 max-w-full rounded-md border bg-background px-3";
  return (
    <main className="min-w-0 space-y-4 p-4 md:p-6">
      <a
        className="inline-flex min-h-11 items-center underline"
        href={search.returnTo ?? "/clients"}
      >
        返回客戶列表
      </a>
      <PageHeader
        title={summary.data?.companyName ?? "客戶工作總覽"}
        subtitle="各頁只顯示目前授權範圍內的資料。"
      />
      <nav aria-label="客戶工作頁" className="flex flex-wrap gap-2">
        {COMPANY_WORKSPACE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={field}
            aria-current={search.tab === tab ? "page" : undefined}
            onClick={() => change({ tab, q: "", history: false, kind: "all", eventType: "all" })}
          >
            {labels[tab]}
          </button>
        ))}
      </nav>
      {query.isError ? (
        <div role="alert" className="rounded-md border p-3">
          客戶資料暫時未能更新；請重試，若持續失敗請聯絡 Admin。支援編號：R19-COMPANY-READ。
          <button type="button" className={field} onClick={() => void query.refetch()}>
            重試
          </button>
        </div>
      ) : null}
      {search.tab === "overview" ? (
        <>
          {summary.data ? (
            <section className="space-y-2 rounded-lg border p-4">
              <p>{summary.data.scopeNotice}</p>
              <p>
                未完成工作 {summary.data.openCases} · 文件 {summary.data.documents} · 欠款案件{" "}
                {summary.data.paymentCases}
              </p>
              <p>尚欠 HK$ {summary.data.outstandingAmount}</p>
              {summary.data.partial ? (
                <p role="status">部分工作來源不可用；未完成工作數只涵蓋可讀来源。</p>
              ) : null}
              <small>更新：{summary.data.observedAt}</small>
            </section>
          ) : null}
          <ProductionClientDetail
            clientId={companyId}
            returnTo={search.returnTo}
            managedWorkspace
          />
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            搜尋這個客戶
            <input
              className={field}
              value={search.q}
              onChange={(e) => change({ q: e.target.value })}
            />
          </label>
          {search.tab === "cases" ? (
            <div className="flex flex-wrap gap-3">
              <label>
                工作類型
                <select
                  className={field}
                  value={search.kind}
                  onChange={(e) =>
                    change({ kind: e.target.value as CompanyWorkspaceSearch["kind"] })
                  }
                >
                  <option value="all">全部工作</option>
                  <option value="annual_return">周年申報</option>
                  <option value="incorporation">公司註冊</option>
                  <option value="corporate_change_request">公司變更</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={search.history}
                  onChange={(e) => change({ history: e.target.checked })}
                />
                包括已完成工作
              </label>
            </div>
          ) : null}
          {search.tab === "activity" ? (
            <label>
              活動類型
              <input
                className={field}
                value={search.eventType === "all" ? "" : search.eventType}
                placeholder="全部類型"
                onChange={(e) => change({ eventType: e.target.value || "all" })}
              />
            </label>
          ) : null}
          <p role="status">
            {page ? `範圍內共 ${page.total} 筆；本頁 ${page.items.length} 筆` : "資料待讀取"}
          </p>
          {search.tab === "cases"
            ? cp?.items.map((row) => (
                <article key={row.workKey} className="space-y-1 rounded-md border p-3">
                  <p>
                    {row.companyName} · 負責人：{row.ownerName} · 到期：{row.dueDate ?? "待核對"}
                  </p>
                  <p>{row.blocker}</p>
                  <a
                    className="inline-flex min-h-11 items-center underline"
                    href={caseHref(row.nextAction.href)}
                  >
                    開啟工作
                  </a>
                </article>
              ))
            : null}
          {search.tab === "documents"
            ? dp?.items.map((doc) => (
                <article key={doc.id} className="space-y-1 rounded-md border p-3">
                  <p className="break-words">{doc.fileName}</p>
                  <p>
                    {doc.currentVersionId
                      ? "請在文件庫核對現行版本、掃描及人工覆核證據。"
                      : "只有登記資料；請補交原始檔案，再核對掃描及人工覆核。"}
                  </p>
                  <a
                    className="inline-flex min-h-11 items-center underline"
                    href={
                      "/documents?" +
                      new URLSearchParams({
                        companyId,
                        documentId: doc.id,
                        ...(doc.caseId ? { caseId: doc.caseId } : {}),
                        returnTo,
                      })
                    }
                  >
                    核對文件來源
                  </a>
                </article>
              ))
            : null}
          {search.tab === "payments"
            ? pp?.items.map((row) => (
                <article key={row.rowId} className="space-y-1 rounded-md border p-3">
                  <p>
                    尚欠 HK$ {row.payment.balance} · 憑證 {row.proofCount}{" "}
                    份；入賬與文件覆核分開核對。
                  </p>
                  <a
                    className="inline-flex min-h-11 items-center underline"
                    href={caseHref("/annual-returns/" + row.caseId)}
                  >
                    核對案件款項
                  </a>
                </article>
              ))
            : null}
          {search.tab === "activity"
            ? ap?.items.map((row) => (
                <article key={row.id} className="space-y-1 rounded-md border p-3">
                  <p className="break-words">{row.description}</p>
                  <p>
                    {row.actorName} · {row.createdAt}
                  </p>
                </article>
              ))
            : null}
          {page && !page.items.length ? <p>這個範圍沒有符合資料。</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={field}
              disabled={!search.cursor}
              onClick={() => change({})}
            >
              第一頁
            </button>
            <button
              type="button"
              className={field}
              disabled={!page?.nextCursor || query.isFetching}
              onClick={() => onSearchChange({ ...search, cursor: page?.nextCursor ?? undefined })}
            >
              下一頁
            </button>
          </div>
          <small>讀取時間：{page?.observedAt ?? "待核對"}</small>
        </>
      )}
    </main>
  );
}
