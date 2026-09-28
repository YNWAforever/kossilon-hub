import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WhatsAppConversationMessage } from "../conversations";
import { listReplyTargets } from "../message-preview-server-fns";
import {
  correctInboundMediaClassification,
  linkInboundMedia,
  listMediaRequirements,
} from "../media-link-server-fns";

type Attachment = WhatsAppConversationMessage["attachments"][number];
const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for provider download",
  processing: "Downloading into private quarantine",
  quarantined: "Quarantined · staff case selection required",
  linked: "Received · malware scan and human review still required",
  manual_reupload: "Provider media expired · request client reupload",
  failed: "Provider download failed · manual follow-up required",
};

export function InboxMediaLink({
  messageId,
  conversationId,
  attachment,
}: {
  messageId: string;
  conversationId: string;
  attachment: Attachment;
}) {
  const queryClient = useQueryClient();
  const [caseId, setCaseId] = useState(attachment.documentCaseId ?? "");
  const [requirementInstanceId, setRequirementInstanceId] = useState("");
  const [reason, setReason] = useState("");
  const actionable =
    attachment.downloadStatus === "quarantined" || attachment.downloadStatus === "linked";
  const targets = useQuery({
    queryKey: ["whatsapp-media-targets", conversationId],
    queryFn: () => listReplyTargets({ data: { conversationId } }),
    enabled: actionable,
    retry: false,
  });
  const requirements = useQuery({
    queryKey: ["whatsapp-media-requirements", caseId],
    queryFn: () => listMediaRequirements({ data: { caseId } }),
    enabled: actionable && Boolean(caseId),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (attachment.position === undefined || attachment.downloadRevision === undefined || !caseId)
        throw new Error("Choose a case and refresh the attachment state.");
      const input = {
        messageId,
        mediaIndex: attachment.position,
        caseId,
        requirementInstanceId: requirementInstanceId || undefined,
        expectedRevision: attachment.downloadRevision,
      };
      if (attachment.downloadStatus === "linked") {
        if (caseId !== attachment.documentCaseId)
          throw new Error("A linked document cannot move to another case.");
        return correctInboundMediaClassification({ data: { ...input, reason } });
      }
      return linkInboundMedia({ data: input });
    },
    onSuccess: async () => {
      setReason("");
      await queryClient.invalidateQueries({
        queryKey: ["whatsapp-conversation-messages", conversationId],
      });
    },
  });
  const caseOptions = [
    ...new Map((targets.data ?? []).map((item) => [item.caseId, item])).values(),
  ];
  return (
    <div className="mt-2 rounded border bg-card p-2 text-xs">
      <p>{STATUS_LABEL[attachment.downloadStatus ?? "pending"] ?? "Media status unknown"}</p>
      {attachment.downloadErrorCode ? (
        <p role="status">Download error: {attachment.downloadErrorCode}</p>
      ) : null}
      {actionable ? (
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1">
            Case for this attachment
            <select
              className="rounded border p-1"
              value={caseId}
              onChange={(event) => {
                setCaseId(event.target.value);
                setRequirementInstanceId("");
              }}
            >
              <option value="">Select a case</option>
              {caseOptions.map((item) => (
                <option key={item.caseId} value={item.caseId}>
                  {item.companyName} · {item.caseId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {targets.isError ? <p role="alert">Unable to load authorized case choices.</p> : null}
          <label className="grid gap-1">
            Requirement (optional)
            <select
              className="rounded border p-1"
              value={requirementInstanceId}
              onChange={(event) => setRequirementInstanceId(event.target.value)}
              disabled={!caseId}
            >
              <option value="">Leave unassigned for review</option>
              {requirements.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.item_label} · {item.requirement_key}
                </option>
              ))}
            </select>
          </label>
          {requirements.isError ? <p role="alert">Unable to load case requirements.</p> : null}
          {attachment.downloadStatus === "linked" ? (
            <label className="grid gap-1">
              Reason for correction
              <input
                className="rounded border p-1"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="w-fit rounded border px-2 py-1 disabled:opacity-50"
            disabled={
              !caseId ||
              mutation.isPending ||
              (attachment.downloadStatus === "linked" && reason.trim().length < 3)
            }
            onClick={() => mutation.mutate()}
          >
            {attachment.downloadStatus === "linked"
              ? "Correct requirement assignment"
              : "Link to selected case"}
          </button>
          {mutation.isError ? (
            <p role="alert" className="text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : "Unable to link media."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
