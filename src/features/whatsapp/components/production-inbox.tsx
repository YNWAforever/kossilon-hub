import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import {
  CONVERSATION_MESSAGE_PAGE_SIZE,
  CONVERSATION_PAGE_SIZE,
  conversationContactLabel,
  conversationMessageOccurredAt,
  formatHongKongTimestamp,
  sortConversationMessagesOldestFirst,
  type WhatsAppConversation,
} from "../conversations";
import {
  getWhatsAppIntegrationStatus,
  listWhatsAppConversationMessages,
  listWhatsAppConversations,
} from "../server-fns";

const EMPTY_INBOX_MESSAGE = "No WhatsApp conversations have been received yet.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load the WhatsApp inbox.";
}

/**
 * What the screen knows about the provider. An empty conversation list means a
 * different thing under each one, and only `live` licenses the claim that no
 * client has messaged the firm.
 */
type InboxConnection = "checking" | "unknown" | "blocked" | "simulated" | "live";

/**
 * The production WhatsApp inbox.
 *
 * Narrower than the demo screen by necessity rather than by omission:
 *
 * - No reply composer. `queueWhatsAppTemplateMessage` needs a template name, a
 *   category and a case id, so free text has nowhere to go. Template sends live on
 *   /whatsapp/automation, which is already wired to production.
 * - No AI assistant panel. `AiAssistantPanel` reads the demo annual-return and
 *   client-portal stores, so it cannot appear on a production screen at all.
 * - No intent or conversation status chips. Neither has a column behind it;
 *   per-message delivery status does, and is shown.
 */
export function ProductionWhatsAppInbox() {
  const [selectedContactId, setSelectedContactId] = useState<string | undefined>();

  const conversationsQuery = useQuery({
    queryKey: ["whatsapp-conversations", CONVERSATION_PAGE_SIZE],
    queryFn: () => listWhatsAppConversations({ data: { limit: CONVERSATION_PAGE_SIZE } }),
    retry: false,
  });

  const integrationQuery = useQuery({
    queryKey: ["whatsapp-integration-status"],
    queryFn: () => getWhatsAppIntegrationStatus(),
    retry: false,
  });

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  // No silent fallback to conversations[0]: once a contact has been chosen, losing
  // it from a refreshed page must not swap another client's thread in underneath
  // someone who is reading.
  const selected: WhatsAppConversation | undefined = selectedContactId
    ? conversations.find((entry) => entry.contactId === selectedContactId)
    : conversations[0];
  const selectionDropped = Boolean(selectedContactId) && selected === undefined;
  const activeContactId = selected?.contactId;

  const messagesQuery = useQuery({
    queryKey: ["whatsapp-conversation-messages", activeContactId],
    queryFn: () => {
      // Guard rather than assert, so the precondition lives with the call it
      // protects instead of being split across `enabled`.
      if (!activeContactId) throw new Error("No WhatsApp conversation is selected.");
      return listWhatsAppConversationMessages({
        data: { contactId: activeContactId, limit: CONVERSATION_MESSAGE_PAGE_SIZE },
      });
    },
    enabled: activeContactId !== undefined,
    retry: false,
  });

  const messages = useMemo(
    () => sortConversationMessagesOldestFirst(messagesQuery.data ?? []),
    [messagesQuery.data],
  );

  // A blocked provider cannot verify a webhook signature and a simulated one sends
  // nothing, so neither records inbound messages. A failed status check means the
  // screen does not know which case it is in — and "unknown" must not be treated
  // as "connected", or an empty list gets reported as "no client has messaged us".
  const connection: InboxConnection = integrationQuery.isPending
    ? "checking"
    : integrationQuery.isError || integrationQuery.data === undefined
      ? "unknown"
      : integrationQuery.data.deliveryMode === "blocked"
        ? "blocked"
        : integrationQuery.data.deliveryMode === "simulated"
          ? "simulated"
          : "live";

  return (
    <div className="grid min-h-screen lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className="border-r bg-card">
        {/* The conversation rail is this screen's header — an inbox has no room
            for a page title above it, so PageHeader sits inside the rail. */}
        <div className="border-b p-4">
          <PageHeader eyebrow="Messaging" title="WhatsApp Inbox" />
        </div>

        {conversationsQuery.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(conversationsQuery.error)}
          </p>
        ) : null}

        {connection === "unknown" ? (
          <p role="alert" className="border-b p-4 text-sm text-destructive">
            {errorMessage(integrationQuery.error)} The WhatsApp connection state could not be
            checked, so this list may be incomplete.
          </p>
        ) : null}

        {connection === "blocked" ? (
          <div
            className="border-b bg-status-yellow-soft p-4 text-sm text-status-yellow"
            role="status"
          >
            <p className="font-medium">WhatsApp is not connected</p>
            <p className="mt-1">
              Inbound messages are not being recorded until these bindings are configured:{" "}
              {integrationQuery.data?.missingLiveEnvVars.join(", ")}.
            </p>
          </div>
        ) : null}

        {connection === "simulated" ? (
          <div className="border-b bg-status-blue-soft p-4 text-sm text-status-blue" role="status">
            <p className="font-medium">Demo simulation</p>
            <p className="mt-1">
              No external WhatsApp message is sent or received, so no conversation is recorded.
            </p>
          </div>
        ) : null}

        {selectionDropped ? (
          <p className="border-b p-4 text-sm text-muted-foreground" role="status">
            That conversation is no longer in this page of the inbox.
          </p>
        ) : null}

        <div className="divide-y">
          {conversationsQuery.isPending ? (
            <p className="p-4 text-sm text-muted-foreground">Loading conversations...</p>
          ) : null}

          {/* Only a confirmed-live provider licenses this claim. Under checking,
              unknown, blocked or simulated an empty list says nothing about
              whether a client has messaged the firm. */}
          {!conversationsQuery.isPending &&
          !conversationsQuery.isError &&
          connection === "live" &&
          conversations.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{EMPTY_INBOX_MESSAGE}</p>
          ) : null}

          {conversations.map((conversation) => (
            <button
              key={conversation.contactId}
              type="button"
              className={`w-full px-4 py-3 text-left hover:bg-muted ${
                selected?.contactId === conversation.contactId ? "bg-muted" : ""
              }`}
              onClick={() => setSelectedContactId(conversation.contactId)}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate font-medium">
                  {conversationContactLabel(conversation)}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatHongKongTimestamp(conversation.lastMessageAt)}
                </span>
              </div>
              <p className="mt-1 max-h-10 overflow-hidden text-sm text-muted-foreground">
                {conversation.lastMessageBody}
              </p>
              {conversation.companyName ? (
                <span className="mt-2 inline-flex rounded-full bg-secondary px-2 py-1 text-xs">
                  {conversation.companyName}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-h-screen flex-col">
        {selected ? (
          <>
            <div className="border-b p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">
                    {conversationContactLabel(selected)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.phoneE164 ?? "No phone number on file"}
                  </p>
                </div>
                {selected.caseId ? (
                  <Link
                    className="shrink-0 rounded-md border px-3 py-2 text-sm"
                    to="/annual-returns/$id"
                    params={{ id: selected.caseId }}
                  >
                    Annual return
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="flex-1 space-y-3 p-6">
              {messagesQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(messagesQuery.error)}
                </p>
              ) : null}

              {messagesQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Loading conversation...</p>
              ) : null}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-xl rounded-lg p-4 text-sm ${
                    message.direction === "inbound"
                      ? "bg-status-green-soft"
                      : "ml-auto bg-secondary"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatHongKongTimestamp(conversationMessageOccurredAt(message))} -{" "}
                    {message.status}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t bg-card p-4 text-sm text-muted-foreground">
              Replies are sent as approved templates from{" "}
              {/* /whatsapp declares validateSearch, so its children must state a
                  search value. `enquiry` addresses a demo fixture and has no
                  production meaning. */}
              <Link className="underline" to="/whatsapp/automation" search={{ enquiry: undefined }}>
                WhatsApp Automation
              </Link>
              .
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            Select a conversation to read it.
          </div>
        )}
      </section>
    </div>
  );
}
