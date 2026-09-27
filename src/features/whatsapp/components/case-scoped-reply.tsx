import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { WhatsAppConversation } from "../conversations";
import type { MessagePreview } from "../message-preview";
import {
  listReplyTargets,
  prepareMessage,
  queueApprovedMessage,
} from "../message-preview-server-fns";

export function CaseScopedReply({
  conversation,
  canPreview,
  canQueue,
}: {
  conversation: WhatsAppConversation;
  canPreview: boolean;
  canQueue: boolean;
}) {
  const queryClient = useQueryClient();
  const [targetKey, setTargetKey] = useState("");
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const targets = useQuery({
    queryKey: ["whatsapp-reply-targets", conversation.contactId],
    queryFn: () => listReplyTargets({ data: { conversationId: conversation.contactId } }),
    retry: false,
  });
  const target = targets.data?.find((item) => targetKey === item.caseId + ":" + item.contactId);
  const prepare = useMutation({
    mutationFn: () => {
      if (!target) throw new Error("Select a case and verified contact.");
      return prepareMessage({
        data: {
          caseId: target.caseId,
          contactId: target.contactId,
          conversationId: conversation.contactId,
          purpose: "reply",
          draft,
        },
      });
    },
    onSuccess: setPreview,
  });
  const queue = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Prepare a fresh preview first.");
      return queueApprovedMessage({
        data: {
          previewId: preview.previewId,
          previewHash: preview.previewHash,
          idempotencyKey: crypto.randomUUID(),
        },
      });
    },
    onSuccess: async () => {
      setPreview(null);
      setDraft("");
      await queryClient.invalidateQueries({
        queryKey: ["whatsapp-conversation-messages", conversation.contactId],
      });
    },
  });

  return (
    <div className="space-y-3 border-t bg-card p-4 text-sm">
      <p className="font-medium">Reply in a case context</p>
      {!canQueue ? (
        <p role="status" className="text-status-yellow">
          Provider delivery is unverified. Queueing is disabled until current provider evidence is
          recorded.
        </p>
      ) : null}
      {targets.isError ? (
        <p role="alert" className="text-destructive">
          {targets.error instanceof Error ? targets.error.message : "Unable to load case contacts."}
        </p>
      ) : null}
      <label className="grid gap-1">
        Case and client contact
        <select
          className="rounded-md border p-2"
          value={targetKey}
          onChange={(event) => {
            setTargetKey(event.target.value);
            setPreview(null);
          }}
        >
          <option value="">Select a case and contact</option>
          {targets.data?.map((item) => (
            <option
              key={item.caseId + ":" + item.contactId}
              value={item.caseId + ":" + item.contactId}
            >
              {item.companyName} · {item.contactName} ({item.contactRole})
              {item.verified ? "" : " · phone needs verification"}
            </option>
          ))}
        </select>
      </label>
      {target && !target.verified ? (
        <p role="status">
          Contact phone or language needs correction.{" "}
          <Link to="/clients/$id" params={{ id: target.companyId }} className="underline">
            Open client contacts
          </Link>
        </p>
      ) : null}
      {!target && targets.data?.length === 0 && conversation.companyId ? (
        <p role="status">
          No case contact matches this number.{" "}
          <Link to="/clients/$id" params={{ id: conversation.companyId }} className="underline">
            Create or correct client contact
          </Link>
        </p>
      ) : null}
      <label className="grid gap-1">
        Draft reply
        <textarea
          className="min-h-24 rounded-md border p-2"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setPreview(null);
          }}
          maxLength={4096}
        />
      </label>
      <button
        type="button"
        className="rounded-md border px-3 py-2 disabled:opacity-50"
        disabled={!canPreview || !target?.verified || !draft.trim() || prepare.isPending}
        onClick={() => prepare.mutate()}
      >
        {prepare.isPending ? "Preparing..." : "Preview actual send"}
      </button>
      {prepare.error ? (
        <p role="alert" className="text-destructive">
          {prepare.error instanceof Error ? prepare.error.message : "Unable to prepare preview."}
        </p>
      ) : null}
      {preview ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="font-medium">Review before queueing</p>
          <p>
            Case: {target?.companyName} · Recipient: {preview.recipientName} (
            {preview.recipientE164})
          </p>
          <p>
            Mode: {preview.sendMode} · Language: {preview.languageCode}
          </p>
          <p className="whitespace-pre-wrap">{preview.renderedText}</p>
          <p className="text-xs text-muted-foreground">Expires: {preview.expiresAt}</p>
          <button
            type="button"
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            disabled={!canQueue || queue.isPending}
            onClick={() => queue.mutate()}
          >
            {queue.isPending ? "Queueing..." : "Approve and queue this reply"}
          </button>
          {queue.error ? (
            <p role="alert" className="text-destructive">
              {queue.error instanceof Error ? queue.error.message : "Unable to queue reply."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
