import { useRef, useState } from "react";
import { LoadingRows } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CircleHelp, FileSearch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  describeSilence,
  isSilenceMeaningful,
  summarize,
} from "@/features/documents/findings-review";
import type { Finding } from "@/features/documents/findings";
import { SafeDocumentPreview } from "@/features/documents/safe-preview";
import {
  listAnnualReturnCaseFindings,
  resolveAnnualReturnCaseFinding,
} from "@/features/annual-return/server-fns";

/**
 * Automatic checks, and what they did not check.
 *
 * The load-bearing decision on this screen is that an empty list is never shown
 * as an empty list. "Nothing found" and "nothing looked" are rendered as
 * different sentences, because today they would otherwise be the same blank
 * space on every document -- the analysis worker refuses anything without a real
 * malware verdict, and the scanner is BLOCKED_INTEGRATION.
 *
 * Nothing here approves anything. A finding is an observation a reviewer reads;
 * resolving one records that a person dealt with it, and is the only write.
 */

function outcomeTone(finding: Finding): string {
  if (finding.outcome === "uncertain") return "bg-status-yellow-soft text-status-yellow-text";
  if (finding.outcome === "pass") return "bg-muted text-muted-foreground";
  return finding.severity === "critical"
    ? "bg-status-red-soft text-status-red-text"
    : "bg-status-orange-soft text-status-orange-text";
}

function outcomeLabel(finding: Finding): string {
  if (finding.outcome === "pass") return "通過";
  if (finding.outcome === "uncertain") return "無法檢查";
  return finding.severity === "critical" ? "必須處理" : "建議查看";
}

function citationLabel(finding: Finding): string | null {
  if (finding.citation.kind !== "version") return null;
  const { pageFrom, pageTo } = finding.citation;
  if (pageFrom === null) return null;
  return pageTo && pageTo !== pageFrom ? `第 ${pageFrom}–${pageTo} 頁` : `第 ${pageFrom} 頁`;
}

export function CaseFindings(props: { caseId: string; locked: boolean }) {
  return <CaseFindingsPanel key={props.caseId} {...props} />;
}

function CaseFindingsPanel({ caseId, locked }: { caseId: string; locked: boolean }) {
  const submitting = useRef(false);
  const recovering = useRef(false);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["annual-return", "case-findings", caseId];

  const findingsQuery = useQuery({
    queryKey,
    queryFn: () => listAnnualReturnCaseFindings({ data: { caseId } }),
    retry: false,
  });

  const resolveMutation = useMutation({
    mutationFn: (input: { findingId: string; expectedDocumentVersionId: string }) =>
      resolveAnnualReturnCaseFinding({
        data: {
          caseId,
          findingId: input.findingId,
          note: null,
          expectedDocumentVersionId: input.expectedDocumentVersionId,
        },
      }),
    retry: false,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      submitting.current = false;
    },
    onError: () => setNeedsReconciliation(true),
  });

  const views = findingsQuery.data ?? [];
  const summary = summarize(views);

  return (
    <section className="border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">自動檢查</h2>
        {needsReconciliation || !findingsQuery.isSuccess || findingsQuery.isFetching ? null : (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-status-red-soft px-2 py-1 text-status-red-text">
              {summary.blocking} 必須處理
            </span>
            <span className="rounded-full bg-status-orange-soft px-2 py-1 text-status-orange-text">
              {summary.advisory} 建議查看
            </span>
            <span className="rounded-full bg-status-yellow-soft px-2 py-1 text-status-yellow-text">
              {summary.uncertain} 無法檢查
            </span>
            {/* Never folded into the counts beside it. "0 problems" across
                documents nobody has looked at is not a reassuring number, it is
                a missing one. */}
            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
              {summary.notAnalysed} 份未經檢查
            </span>
          </div>
        )}
      </div>

      {findingsQuery.error && !needsReconciliation ? (
        <div
          role="alert"
          className="mt-3 space-y-2 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        >
          <p>無法載入自動檢查結果。這不代表文件沒有問題，請直接查閱文件。</p>
          <Button
            type="button"
            className="min-h-11"
            disabled={findingsQuery.isFetching}
            onClick={() => void findingsQuery.refetch({ cancelRefetch: false })}
          >
            重新載入自動檢查結果
          </Button>
        </div>
      ) : null}
      {needsReconciliation ? (
        <div role="alert" className="mt-2 space-y-2 text-sm">
          <p>標記結果未確認。請先重新核對當前檢查結果；沒有自動重試標記操作。</p>
          <Button
            type="button"
            className="min-h-11"
            disabled={reconciling}
            onClick={async () => {
              if (recovering.current) return;
              recovering.current = true;
              setReconciling(true);
              try {
                // Read independently: query cancellation can resolve refetch
                // with reverted cache data instead of a new server response.
                await queryClient.cancelQueries({ queryKey, exact: true });
                const findings = await listAnnualReturnCaseFindings({ data: { caseId } });
                if (!Array.isArray(findings)) throw new Error("Findings unavailable");
                // Older/background reads must not overwrite this readback.
                await queryClient.cancelQueries({ queryKey, exact: true });
                queryClient.setQueryData(queryKey, findings);
                resolveMutation.reset();
                submitting.current = false;
                setNeedsReconciliation(false);
              } catch {
                // Keep all case findings closed until explicit readback succeeds.
              } finally {
                recovering.current = false;
                setReconciling(false);
              }
            }}
          >
            重新核對標記結果
          </Button>
        </div>
      ) : null}

      {/* Cached results are not current read evidence. Hide their previews and
          resolution controls while refreshing or after a failed read. */}
      {needsReconciliation ? null : findingsQuery.isPending || findingsQuery.isFetching ? (
        <LoadingRows label="正在載入核對結果…" rows={2} className="mt-3 p-0" />
      ) : findingsQuery.isError ? null : views.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">此案件尚未收到文件。</p>
      ) : (
        <div className="mt-3 divide-y border-y">
          {views.map((view) => (
            <div key={view.documentVersionId} className="py-3">
              <div className="flex items-center gap-2">
                <FileSearch aria-hidden className="h-4 w-4 text-muted-foreground" />
                <p className="truncate text-sm font-medium">{view.fileName}</p>
              </div>
              {view.document ? (
                <div className="mt-2">
                  <SafeDocumentPreview
                    document={view.document}
                    label="查看引用文件的當前版本"
                    title="引用文件預覽"
                  />
                </div>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                AI 建議須由人手核對引用；標記已處理只記錄覆核，文件及交件批准仍須完成各自程序。
              </p>
              {view.provenance ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  模型：
                  {typeof view.provenance.model === "string"
                    ? view.provenance.model
                    : "供應商未提供"}
                  ；成本：
                  {typeof view.provenance.cost === "number" ? view.provenance.cost : "供應商未提供"}
                  。{view.evidence?.method === "manual" ? "文字未能讀取，需要人工查閱。" : null}
                </p>
              ) : null}

              {view.findings.length === 0 ? (
                // The whole point. A document nothing has analysed says so, in
                // words, rather than showing the same blank space as a clean one.
                <p
                  className={`mt-2 text-xs ${
                    isSilenceMeaningful(view.state)
                      ? "text-muted-foreground"
                      : "text-status-yellow-text"
                  }`}
                >
                  {describeSilence(view.state)}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {view.findings.map((entry) => {
                    const cited = citationLabel(entry.finding);
                    return (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] ${outcomeTone(entry.finding)}`}
                            >
                              {outcomeLabel(entry.finding)}
                            </span>
                            {/* A model's observation is labelled as one. It is
                                advisory and cannot hold a filing back, and a
                                reviewer should be able to see which is which
                                without reading the rule key. */}
                            {entry.finding.tier === "provider" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                <Sparkles aria-hidden className="h-3 w-3" />
                                AI 觀察（僅供參考）
                              </span>
                            ) : null}
                            {cited ? (
                              <span className="text-[11px] text-muted-foreground">{cited}</span>
                            ) : null}
                            {entry.resolvedByUserId ? (
                              <span className="text-[11px] text-muted-foreground">已處理</span>
                            ) : null}
                          </div>
                          {/* Plain text. Never rendered as markup, never read
                              back as an instruction: this string can come from a
                              model that read a document an uploader wrote. */}
                          <p className="mt-1 text-sm text-foreground">{entry.finding.detail}</p>
                          {entry.finding.evidence?.spans.map((span, index) => (
                            <blockquote
                              key={`${span.page}-${span.start}-${index}`}
                              className="mt-2 whitespace-pre-wrap border-l-2 pl-2 text-xs text-muted-foreground"
                            >
                              第 {span.page} 頁：「{span.quote}」
                            </blockquote>
                          ))}
                        </div>

                        {entry.resolvedByUserId ? null : (
                          <Button
                            size="sm"
                            disabled={locked || resolveMutation.isPending}
                            onClick={() => {
                              // The pending render cannot guard two same-turn clicks.
                              if (locked || submitting.current || findingsQuery.isFetching) return;
                              submitting.current = true;
                              resolveMutation.mutate({
                                findingId: entry.id,
                                expectedDocumentVersionId: view.documentVersionId,
                              });
                            }}
                          >
                            {entry.finding.outcome === "uncertain" ? (
                              <CircleHelp aria-hidden className="h-3.5 w-3.5" />
                            ) : (
                              <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                            )}
                            標記為已處理
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
