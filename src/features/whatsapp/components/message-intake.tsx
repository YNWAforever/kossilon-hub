import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAnnualReturnCase, listAnnualReturnCasePage } from "@/features/annual-return/server-fns";
import { annualReturnQueryKeys } from "@/features/annual-return/query-keys";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/features/documents/types";
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
      if (!preview.data?.caseId) throw new Error("Case mapping required.");
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
      if (!preview.data) throw new Error("Refresh the message preview.");
      return mapWhatsAppMessage({
        data: { messageId, caseId, expectedVersion: preview.data.version, reason },
      });
    },
    onSuccess: refresh,
  });
  const intake = useMutation({
    mutationFn: (mediaId: string) => {
      if (!preview.data) throw new Error("Refresh the message preview.");
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
      <button type="button" className="underline" onClick={() => setOpen((value) => !value)}>
        Review message mapping and attachments
      </button>
      {open ? (
        <section aria-label="Message intake review" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Confirm the client and annual return year before mapping. Received attachments stay
            quarantined until a genuine scan and human review.
          </p>
          {error ? (
            <p role="alert" className="text-destructive">
              {error instanceof Error
                ? error.message
                : "Unable to complete intake. Refresh and review the message."}
            </p>
          ) : null}
          {preview.isPending ? <p>Loading message preview…</p> : null}
          {preview.data ? (
            <>
              <p>Mapped case: {preview.data.caseId ?? "Unmapped — Admin confirmation required"}</p>
              {canManageMapping &&
              !preview.data.media.some((media) => media.intentId || media.documentId) ? (
                <div className="space-y-2">
                  <label className="block">
                    Search client cases
                    <input
                      aria-label="Search client cases"
                      value={search}
                      maxLength={120}
                      onChange={(event) => setSearch(event.target.value)}
                      className="block w-full border p-2"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(search.trim());
                      setCursor(undefined);
                      setCaseId("");
                    }}
                  >
                    Search cases
                  </button>
                  <label className="block">
                    Target client case
                    <select
                      aria-label="Target client case"
                      value={caseId}
                      onChange={(event) => {
                        setCaseId(event.target.value);
                        setChecklistItemId("");
                      }}
                      className="block w-full border p-2"
                    >
                      <option value="">Choose a confirmed client case</option>
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
                    <button
                      type="button"
                      onClick={() => {
                        setCursor(cases.data!.nextCursor!);
                        setCaseId("");
                      }}
                    >
                      Next cases
                    </button>
                  ) : null}
                  <label className="block">
                    Mapping confirmation reason
                    <textarea
                      aria-label="Mapping confirmation reason"
                      value={reason}
                      maxLength={1000}
                      onChange={(event) => setReason(event.target.value)}
                      className="block w-full border p-2"
                    />
                  </label>
                  {selectedCase ? (
                    <p>
                      Confirm {selectedCase.companyName} · annual return {selectedCase.returnYear}.
                      This maps this message only.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      !selectedCase || !reason.trim() || mapping.isPending || intake.isPending
                    }
                    onClick={() => mapping.mutate()}
                  >
                    Approve case mapping
                  </button>
                </div>
              ) : null}
              {preview.data.media.length ? (
                <label className="block">
                  Attachment category
                  <select
                    aria-label="Attachment category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as DocumentCategory)}
                    className="block border p-2"
                  >
                    {DOCUMENT_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p>No media references recorded.</p>
              )}
              {mappedCase.data ? (
                <label className="block">
                  Matching checklist item
                  <select
                    aria-label="Matching checklist item"
                    value={checklistItemId}
                    onChange={(event) => setChecklistItemId(event.target.value)}
                    className="block w-full border p-2"
                  >
                    <option value="">Unbound — internal review must link the requirement</option>
                    {mappedCase.data.checklist.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.itemLabel} · {item.status}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {preview.data.media.map((media) => (
                <div key={media.id} className="space-y-1 border p-2">
                  <p>{media.mediaType.toLowerCase()} attachment</p>
                  {media.documentId ? (
                    <p>
                      Attachment received. Scan and review status is in the case document workflow.
                    </p>
                  ) : media.kind === "file" ? (
                    <button
                      type="button"
                      disabled={!preview.data?.caseId || intake.isPending || mapping.isPending}
                      onClick={() => intake.mutate(media.id)}
                    >
                      Receive attachment into quarantine
                    </button>
                  ) : (
                    <p>
                      Legacy media reference: the provider must supply a universal fileId, or the
                      client must use the upload portal.
                    </p>
                  )}
                </div>
              ))}
            </>
          ) : null}
          {intake.data?.status === "received" ? (
            <p role="status">
              Attachment received ({intake.data.uploadStatus}). Scanning and human review remain
              separate.
            </p>
          ) : intake.data ? (
            <p role="alert">
              {intake.data.errorCode}. Ask the provider or storage owner to resolve this block; no
              receipt or clean scan has been recorded.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
