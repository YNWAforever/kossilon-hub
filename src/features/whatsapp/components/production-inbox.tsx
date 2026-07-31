import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import {
  conversationContactLabel,
  conversationMessageOccurredAt,
  sortConversationMessagesOldestFirst,
  type WhatsAppConversation,
} from "../conversations";
import {
  getWhatsAppIntegrationStatus,
  listWhatsAppConversationMessages,
  listWhatsAppConversations,
} from "../server-fns";

const CONVERSATION_PAGE_SIZE = 100;
const MESSAGE_PAGE_SIZE = 200;

const EMPTY_INBOX_MESSAGE = "No WhatsApp conversations have been received yet.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load the WhatsApp inbox.";
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().slice(0, 16).replace("T", " ");
}

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
  const selected: WhatsAppConversation | undefined =
    conversations.find((entry) => entry.contactId === selectedContactId) ?? conversations[0];

  const messagesQuery = useQuery({
    queryKey: ["whatsapp-conversation-messages", selected?.contactId],
    queryFn: () =>
      listWhatsAppConversationMessages({
        data: { contactId: selected!.contactId, limit: MESSAGE_PAGE_SIZE },
      }),
    enabled: Boolean(selected),
    retry: false,
  });

  const messages = useMemo(
    () => sortConversationMessagesOldestFirst(messagesQuery.data ?? []),
    [messagesQuery.data],
  );

  // A blocked provider cannot verify a webhook signature, so no inbound message is
  // ever recorded. Reporting that as "nothing received yet" would state something
  // about the clients rather than about the integration.
  const notConnected =
    integrationQuery.data !== undefined && integrationQuery.data.deliveryMode === "blocked";

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

        {notConnected ? (
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

        <div className="divide-y">
          {conversationsQuery.isPending ? (
            <p className="p-4 text-sm text-muted-foreground">Loading conversations...</p>
          ) : null}

          {/* Gated on isError and on the integration state as well as isPending:
              an empty list means three different things across the three. */}
          {!conversationsQuery.isPending &&
          !conversationsQuery.isError &&
          !notConnected &&
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
                  {formatTimestamp(conversation.lastMessageAt)}
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
                    {formatTimestamp(conversationMessageOccurredAt(message))} - {message.status}
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
