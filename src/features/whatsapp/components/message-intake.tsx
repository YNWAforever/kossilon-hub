import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAnnualReturnCase, listAnnualReturnCasePage } from "@/features/annual-return/server-fns";
import { annualReturnQueryKeys } from "@/features/annual-return/query-keys";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/features/documents/types";
import { labelValue } from "@/lib/format-label";
import { checklistStatusLabel } from "@/features/annual-return/labels";
import {
  previewWhatsAppMessage,
  mapWhatsAppMessage,
  intakeWhatsAppMedia,
} from "../intake-server-fns";

export function MessageIntake({
  messageId,
  canManageMapping,
}: {
  messageId: string;
  canManageMapping: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [category, setCategory] = useState<DocumentCategory>("other");
  const [checklistItemId, setChecklistItemId] = useState("");
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ["whatsapp-message-intake", messageId],
    queryFn: () => previewWhatsAppMessage({ data: { messageId } }),
    enabled: open,
    retry: false,
  });
  const cases = useQuery({
    queryKey: ["whatsapp-mapping-cases", query, cursor],
    queryFn: () =>
      listAnnualReturnCasePage({
        data: {
          activeOnly: true,
          limit: 25,
          includeFixtures: false,
          ...(query ? { q: query } : {}),
          ...(cursor ? { cursor } : {}),
        },
      }),
    enabled: open && canManageMapping,
    retry: false,
  });
  const mappedCase = useQuery({
    queryKey: ["whatsapp-intake-case", preview.data?.caseId],
    queryFn: () => {
      if (!preview.data?.caseId) throw new Error("須先配對案件。");
      return getAnnualReturnCase({ data: { id: preview.data.caseId } });
    },
    enabled: open && Boolean(preview.data?.caseId),
    retry: false,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["whatsapp-message-intake", messageId] }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation-messages"] }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp-intake-case"] }),
      queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all }),
    ]);
  const mapping = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error("請重新載入訊息預覽。");
      return mapWhatsAppMessage({
        data: { messageId, caseId, expectedVersion: preview.data.version, reason },
      });
    },
    onSuccess: refresh,
  });
  const intake = useMutation({
    mutationFn: (mediaId: string) => {
      if (!preview.data) throw new Error("請重新載入訊息預覽。");
      return intakeWhatsAppMedia({
        data: {
          mediaId,
          expectedMappingVersion: preview.data.version,
          category,
          ...(checklistItemId ? { checklistItemId } : {}),
        },
      });
    },
    onSuccess: refresh,
  });
  const error = preview.error ?? cases.error ?? mappedCase.error ?? mapping.error ?? intake.error;
  const selectedCase = cases.data?.cases.find((candidate) => candidate.id === caseId);
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <Button type="button" variant="link" onClick={() => setOpen((value) => !value)}>
        覆核訊息配對及附件
      </Button>
      {open ? (
        <section aria-label="訊息收件覆核" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            配對前請先確認客戶及周年申報年度。收到的附件會保持隔離，直至完成真實掃描及人手覆核。
          </p>
          {error ? (
            <p role="alert" className="text-destructive">
              {error instanceof Error ? error.message : "未能完成收件，請重新載入並覆核訊息。"}
            </p>
          ) : null}
          {preview.isPending ? <p>訊息預覽載入中…</p> : null}
          {preview.data ? (
            <>
              <p>已配對案件：{preview.data.caseId ?? "未配對 — 須由管理員確認"}</p>
              {canManageMapping &&
              !preview.data.media.some((media) => media.intentId || media.documentId) ? (
                <div className="space-y-2">
                  <label className="block">
                    搜尋客戶案件
                    <input
                      aria-label="搜尋客戶案件"
                      value={search}
                      maxLength={120}
                      onChange={(event) => setSearch(event.target.value)}
                      className="block w-full border p-2"
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setQuery(search.trim());
                      setCursor(undefined);
                      setCaseId("");
                    }}
                  >
                    搜尋案件
                  </Button>
                  <label className="block">
                    目標客戶案件
                    <select
                      aria-label="目標客戶案件"
                      value={caseId}
                      onChange={(event) => {
                        setCaseId(event.target.value);
                        setChecklistItemId("");
                      }}
                      className="block w-full border p-2"
                    >
                      <option value="">選擇已確認的客戶案件</option>
                      {cases.data?.cases
                        .filter(
                          (candidate) =>
                            candidate.dataOrigin === "client" &&
                            !candidate.lockedAt &&
                            !["Filed", "Completed"].includes(candidate.currentStatus),
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.companyName} · {candidate.returnYear}
                          </option>
                        ))}
                    </select>
                  </label>
                  {cases.data?.nextCursor ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setCursor(cases.data!.nextCursor!);
                        setCaseId("");
                      }}
                    >
                      下一頁案件
                    </Button>
                  ) : null}
                  <label className="block">
                    配對確認原因
                    <textarea
                      aria-label="配對確認原因"
                      value={reason}
                      maxLength={1000}
                      onChange={(event) => setReason(event.target.value)}
                      className="block w-full border p-2"
                    />
                  </label>
                  {selectedCase ? (
                    <p>
                      確認配對至 {selectedCase.companyName} · {selectedCase.returnYear}{" "}
                      年度周年申報。只會配對此訊息。
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={
                      !selectedCase || !reason.trim() || mapping.isPending || intake.isPending
                    }
                    onClick={() => mapping.mutate()}
                  >
                    批准案件配對
                  </Button>
                </div>
              ) : null}
              {preview.data.media.length ? (
                <label className="block">
                  附件類別
                  <select
                    aria-label="附件類別"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as DocumentCategory)}
                    className="block border p-2"
                  >
                    {DOCUMENT_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {labelValue(value)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p>未有媒體記錄。</p>
              )}
              {mappedCase.data ? (
                <label className="block">
                  對應清單項目
                  <select
                    aria-label="對應清單項目"
                    value={checklistItemId}
                    onChange={(event) => setChecklistItemId(event.target.value)}
                    className="block w-full border p-2"
                  >
                    <option value="">未連結 — 須於內部覆核時連結要求</option>
                    {mappedCase.data.checklist.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.itemLabel} · {checklistStatusLabel(item.status)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {preview.data.media.map((media) => (
                <div key={media.id} className="space-y-1 border p-2">
                  <p>{media.mediaType.toLowerCase()} 附件</p>
                  {media.documentId ? (
                    <p>已收到附件。掃描及覆核狀態可在案件文件流程查看。</p>
                  ) : media.kind === "file" ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={!preview.data?.caseId || intake.isPending || mapping.isPending}
                      onClick={() => intake.mutate(media.id)}
                    >
                      將附件收入隔離區
                    </Button>
                  ) : (
                    <p>舊式媒體參考：須由供應商提供通用 fileId，或請客戶使用上載入口。</p>
                  )}
                </div>
              ))}
            </>
          ) : null}
          {intake.data?.status === "received" ? (
            <p role="status">
              已收到附件（{labelValue(intake.data.uploadStatus)}）。掃描及人手覆核須另行進行。
            </p>
          ) : intake.data ? (
            <p role="alert">
              {intake.data.errorCode}
              。請聯絡供應商或儲存管理人解決此問題；目前未有記錄任何收件或安全掃描結果。
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
