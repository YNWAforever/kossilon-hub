import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCaseHandoffs, runHandoffCommand } from "../handoff-server-fns";
import { handoffFactLabel } from "../handoff";
import { DocumentPicker } from "./scoped-pickers";
import { DOCUMENT_CATEGORIES } from "@/features/documents/types";
import { annualReturnQueryKeys } from "../query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
const categories = DOCUMENT_CATEGORIES;
export function CaseHandoff({
  caseId,
  locked,
  actorScope = "session",
}: {
  caseId: string;
  locked: boolean;
  actorScope?: string;
}) {
  const client = useQueryClient(),
    key = ["annual-return", "handoff", caseId];
  const workflow = useQuery({
    queryKey: key,
    queryFn: () => getCaseHandoffs({ data: { caseId } }),
    retry: false,
  });
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false),
    [selected, setSelected] = useState(""),
    [reference, setReference] = useState(""),
    [note, setNote] = useState(""),
    [occurredAt, setOccurredAt] = useState(""),
    [evidenceId, setEvidenceId] = useState(""),
    [returnDocId, setReturnDocId] = useState(""),
    [returnHash, setReturnHash] = useState(""),
    [returnReference, setReturnReference] = useState(""),
    [detail, setDetail] = useState(""),
    [outcome, setOutcome] = useState<"accepted" | "rejected" | "partial" | "unmatched">("rejected"),
    [returnKey, setReturnKey] = useState(() => crypto.randomUUID()),
    [reconciliationNotes, setReconciliationNotes] = useState<Record<string, string>>({}),
    [withdrawNote, setWithdrawNote] = useState("");
  const data = workflow.data,
    p = data?.preview,
    h = data?.handoffs.find((x) => x.id === selected) ?? data?.handoffs[0],
    openBlockers = p?.blockers.filter((b) => b.stage !== "transmit").length ?? 0;
  useEffect(() => {
    setConfirmed(false);
  }, [p?.sourceVersion]);
  const refresh = async () => {
    setConfirmed(false);
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: annualReturnQueryKeys.all }),
    ]);
  };
  const command = useMutation({
    mutationFn: (input: Parameters<typeof runHandoffCommand>[0]["data"]) =>
      runHandoffCommand({ data: input }),
    onSuccess: refresh,
    retry: false,
  });
  const archive = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/handoffs/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoffId: h!.id, expectedVersion: p!.sourceVersion! }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "套件版本已變，請重新覆核"
            : "套件匯出失敗，請核對權限、文件及儲存狀態",
        );
      return { body: await response.blob(), fileName: `approved-package-${h!.id}.zip` };
    },
    onSuccess: async (result) => {
      const url = URL.createObjectURL(result.body);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await refresh();
    },
    retry: false,
  });
  const disabled = locked || command.isPending || archive.isPending;
  const current = h?.manifestSha256 === p?.manifestSha256 && p?.readyForApproval;
  const evidence = (id: string) => selectedVersions[id] ?? null;
  return (
    <section className="space-y-4 border-b pb-4">
      <h2 className="text-base font-semibold">套件批准、交件及回件</h2>
      <p className="text-sm text-muted-foreground">
        匯出不等於提交。人工紀錄是操作員陳述；目的地收據亦不等於監管已受理。所有寫入重新核對權限及當前版本。
      </p>
      <p className="text-sm text-status-yellow-text">
        未配置外部交件連接器；現時只提供人工流程，未驗證系統傳送。
      </p>
      {workflow.isPending ? (
        <p>載入交件紀錄…</p>
      ) : workflow.error ? (
        <p role="alert">無法載入交件紀錄：{workflow.error.message}</p>
      ) : (
        <>
          {data?.handoffs.length === 0 && data.returns.length === 0 ? (
            <p className="text-sm">未有人工交件或回件紀錄；這不代表外部沒有異常。</p>
          ) : null}
          <div className="space-y-2 rounded-md border p-3">
            <p className="break-all text-xs">
              當前 manifest SHA256：{p?.manifestSha256 ?? "未有可批准套件"}
            </p>
            {/* The packet section lists every blocker with a link to fix it;
                repeating the list here doubled the page. */}
            {openBlockers > 0 ? (
              <p className="text-sm text-status-yellow-text">
                尚有 {openBlockers} 項事項須先處理，未能批准。
                <a href="#case-blockers" className="ml-1 underline">
                  查看交件阻礙事項
                </a>
              </p>
            ) : null}
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={disabled || !p?.readyForApproval}
              />
              已核對當前文件、付款及 manifest，批准此版本
            </label>
            <Button
              type="button"
              disabled={disabled || !confirmed || !p?.sourceVersion || !p.manifestSha256}
              onClick={() =>
                command.mutate({
                  command: "approve",
                  caseId,
                  expectedVersion: p!.sourceVersion!,
                  manifestSha256: p!.manifestSha256!,
                })
              }
            >
              批准當前套件
            </Button>
          </div>
          {data?.handoffs.length ? (
            <>
              <label className="block text-sm">
                交件套件
                <Select
                  aria-label="交件套件"
                  className="mt-1 w-full"
                  value={h?.id ?? ""}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setReturnHash("");
                    setReturnKey(crypto.randomUUID());
                  }}
                >
                  {data.handoffs.map((row) => (
                    <option key={row.id} value={row.id}>
                      {handoffFactLabel(row.deliveryFact)} · {row.createdAt}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="text-sm">{handoffFactLabel(h?.deliveryFact ?? null)}</p>
              <p className="break-all text-xs">
                批准 manifest：{h?.manifestSha256} · 批准人：{h?.approvedBy}
              </p>
              {h?.manualRecordedAt ? (
                <p className="text-sm">
                  人工操作員：{h.manualRecordedBy} · 操作時間：{h.manualOccurredAt} · 記錄時間：
                  {h.manualRecordedAt} · 參考：{h.manualReference} · {h.manualNote}
                </p>
              ) : null}
              <Button
                type="button"
                disabled={
                  disabled ||
                  !current ||
                  !p?.sourceVersion ||
                  ["unknown"].includes(h?.deliveryFact ?? "") ||
                  ["cancelled", "failed"].includes(h?.status ?? "")
                }
                onClick={() => archive.mutate()}
              >
                匯出已批准 ZIP（未提交）
              </Button>
              {h?.status === "prepared" ? (
                <>
                  <form
                    className="space-y-3 rounded-md border p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      command.mutate({
                        command: "manual_submission",
                        handoffId: h.id,
                        expectedVersion: p!.sourceVersion!,
                        occurredAt: new Date(occurredAt).toISOString(),
                        reference,
                        note,
                        evidenceDocumentId: evidenceId || null,
                        evidenceVersionId: evidence(evidenceId),
                      });
                    }}
                  >
                    <h3 className="font-medium">人手外部上載後，記錄操作證明</h3>
                    <label className="block text-sm">
                      實際提交時間
                      <Input
                        required
                        type="datetime-local"
                        step="1"
                        className="mt-1 w-full"
                        value={occurredAt}
                        onChange={(e) => setOccurredAt(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      人工提交參考
                      <Input
                        required
                        maxLength={200}
                        className="mt-1 w-full"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      操作說明
                      <Textarea
                        required
                        maxLength={1000}
                        className="mt-1 w-full"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <DocumentPicker
                      actorScope={actorScope}
                      onSelectDocument={(document) => {
                        if (document?.currentVersionId)
                          setSelectedVersions((current) => ({
                            ...current,
                            [document.id]: document.currentVersionId!,
                          }));
                      }}
                      id={`handoff-proof-${caseId}`}
                      label="提交證明（可選，先完成掃描及覆核）"
                      caseId={caseId}
                      categories={categories}
                      value={evidenceId}
                      onChange={setEvidenceId}
                      disabled={disabled}
                    />
                    <Button
                      type="submit"
                      disabled={
                        disabled ||
                        !current ||
                        !h.exportedAt ||
                        !p?.sourceVersion ||
                        (!!evidenceId && !evidence(evidenceId))
                      }
                    >
                      記錄人工提交（無系統收據）
                    </Button>
                  </form>
                  <label className="block text-sm">
                    撤回未提交套件原因
                    <Input
                      maxLength={1000}
                      className="mt-1 w-full"
                      value={withdrawNote}
                      onChange={(e) => setWithdrawNote(e.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={disabled || !withdrawNote.trim() || !p?.sourceVersion}
                    onClick={() =>
                      command.mutate({
                        command: "withdraw",
                        handoffId: h.id,
                        expectedVersion: p!.sourceVersion!,
                        note: withdrawNote,
                      })
                    }
                  >
                    撤回此批准，重新覆核
                  </Button>
                </>
              ) : null}
              {h?.manualRecordedAt || h?.providerAccepted ? (
                <form
                  className="space-y-3 rounded-md border p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    command.mutate(
                      {
                        command: "return",
                        handoffId: h!.id,
                        idempotencyKey: returnKey,
                        returnedManifestSha256: returnHash,
                        outcome,
                        reference: returnReference,
                        detail,
                        documentId: returnDocId || null,
                        documentVersionId: evidence(returnDocId),
                      },
                      {
                        onSuccess: () => {
                          setReturnKey(crypto.randomUUID());
                          setReturnReference("");
                          setDetail("");
                          setReturnHash("");
                          setReturnDocId("");
                        },
                      },
                    );
                  }}
                >
                  <h3 className="font-medium">人工登記回件</h3>
                  <p className="text-sm">
                    先在文件頁上載回件；附件會留在掃描隔離流程。核對不會自動記付款、已交件或結案。
                  </p>
                  <Button asChild variant="link" className="underline">
                    <a href={`/documents?caseId=${caseId}`}>上載及覆核回件附件</a>
                  </Button>
                  <label className="block text-sm">
                    回件指向的 manifest SHA256
                    <Input
                      required
                      pattern="[a-f0-9]{64}"
                      className="mt-1 w-full"
                      value={returnHash}
                      onChange={(e) => setReturnHash(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    回件參考
                    <Input
                      required
                      maxLength={200}
                      className="mt-1 w-full"
                      value={returnReference}
                      onChange={(e) => setReturnReference(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    回件結果
                    <Select
                      className="mt-1 w-full"
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                    >
                      <option value="rejected">要求補件／拒收</option>
                      <option value="partial">部分回件</option>
                      <option value="accepted">對方聲稱接收（待核對）</option>
                      <option value="unmatched">未能匹配</option>
                    </Select>
                  </label>
                  <label className="block text-sm">
                    原始回件說明
                    <Textarea
                      required
                      maxLength={2000}
                      className="mt-1 w-full"
                      value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                    />
                  </label>
                  <DocumentPicker
                    actorScope={actorScope}
                    onSelectDocument={(document) => {
                      if (document?.currentVersionId)
                        setSelectedVersions((current) => ({
                          ...current,
                          [document.id]: document.currentVersionId!,
                        }));
                    }}
                    id={`handoff-return-${caseId}`}
                    label="回件附件（可含待掃描文件）"
                    caseId={caseId}
                    categories={categories}
                    value={returnDocId}
                    onChange={setReturnDocId}
                    requireVerified={false}
                    disabled={disabled}
                  />
                  <Button
                    type="submit"
                    disabled={disabled || (!!returnDocId && !evidence(returnDocId))}
                  >
                    登記人工回件，待核對
                  </Button>
                </form>
              ) : null}
            </>
          ) : null}
          {data?.returns.map((r) => (
            <div key={r.id} className="space-y-2 rounded-md border p-3">
              <p className="text-sm">
                {r.source === "manual"
                  ? "人工登記"
                  : r.source === "provider"
                    ? "provider 紀錄"
                    : "歷史來源未確認"}{" "}
                · {r.outcome} · {r.reference} · {r.detail}
              </p>
              <p className="break-all text-xs">
                原套件 manifest：{data.handoffs.find((x) => x.id === r.handoffId)?.manifestSha256} ·
                回件 manifest：{r.returnedManifestSha256 ?? "未確認"}
              </p>
              {r.reconciledAt ? (
                <p className="text-sm">
                  已人手核對：{r.reconciledAt} · {r.reconciliationNote}；拒收／部分回件仍需處理。
                </p>
              ) : (
                <>
                  <label className="block text-sm">
                    核對說明
                    <Textarea
                      maxLength={1000}
                      className="mt-1 w-full"
                      value={reconciliationNotes[r.id] ?? ""}
                      onChange={(e) =>
                        setReconciliationNotes({ ...reconciliationNotes, [r.id]: e.target.value })
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={
                      disabled ||
                      !(reconciliationNotes[r.id] ?? "").trim() ||
                      r.outcome === "unmatched"
                    }
                    onClick={() =>
                      command.mutate({
                        command: "reconcile",
                        returnId: r.id,
                        note: reconciliationNotes[r.id],
                      })
                    }
                  >
                    核對原 manifest 及回件證據
                  </Button>
                </>
              )}
            </div>
          ))}
        </>
      )}
      {command.error || archive.error ? (
        <p role="alert" className="text-sm text-destructive">
          {command.error?.message ?? archive.error?.message}；請重新載入及核對，不會自動重試。
        </p>
      ) : null}
    </section>
  );
}
