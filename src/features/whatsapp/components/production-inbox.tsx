import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Paperclip } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { MessageIntake } from "./message-intake";
import {
  conversationContactLabel,
  conversationMessageOccurredAt,
  formatHongKongTimestamp,
  sortConversationMessagesOldestFirst,
  type WhatsAppConversationMessage,
} from "../conversations";
import { getWhatsAppIntegrationStatus } from "../server-fns";
import { listWhatsAppConversationPage, listWhatsAppMessagePage } from "../history-server-fns";
import type { HistoryThread } from "../history-page";

const EMPTY_INBOX_MESSAGE = "No WhatsApp conversations are recorded in your current scope.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load the WhatsApp inbox.";
}

/**
 * These states describe configuration, never verified tenant health. An empty
 * database page only describes the actor's recorded conversations.
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
export function ProductionWhatsAppInbox({ actorScope = "" }: { actorScope?: string }) {
  return <InboxSession key={actorScope} actorScope={actorScope} />;
}
function InboxSession({ actorScope }: { actorScope: string }) {
  const [selectedContactId, setSelectedContactId] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [newMessages, setNewMessages] = useState<WhatsAppConversationMessage[]>([]);
  const transcript = useRef<HTMLDivElement>(null),
    anchor = useRef<{ height: number; top: number } | null>(null);

  const conversationsQuery = useInfiniteQuery({
    queryKey: ["whatsapp-conversations", actorScope, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listWhatsAppConversationPage({ data: { q, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const integrationQuery = useQuery({
    queryKey: ["whatsapp-integration-status", actorScope],
    queryFn: () => getWhatsAppIntegrationStatus(),
    retry: false,
  });

  const conversations = useMemo(
    () => [
      ...new Map(
        (conversationsQuery.data?.pages.flatMap((p) => p.items) ?? []).map((c) => [c.contactId, c]),
      ).values(),
    ],
    [conversationsQuery.data],
  );
  useEffect(() => {
    if (!selectedContactId && conversations[0]) setSelectedContactId(conversations[0].contactId);
  }, [selectedContactId, conversations]);

  // No silent fallback to conversations[0]: once a contact has been chosen, losing
  // it from a refreshed page must not swap another client's thread in underneath
  // someone who is reading.
  const selected: HistoryThread | undefined = selectedContactId
    ? conversations.find((entry) => entry.contactId === selectedContactId)
    : conversations[0];
  const selectionDropped = Boolean(selectedContactId) && selected === undefined;
  const activeContactId = selected?.contactId;

  const messagesQuery = useInfiniteQuery({
    queryKey: ["whatsapp-conversation-messages", actorScope, activeContactId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      // Guard rather than assert, so the precondition lives with the call it
      // protects instead of being split across `enabled`.
      if (!activeContactId) throw new Error("No WhatsApp conversation is selected.");
      return listWhatsAppMessagePage({
        data: { contactId: activeContactId, cursor: pageParam, limit: 50 },
      });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: activeContactId !== undefined,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const messages = useMemo(
    () =>
      sortConversationMessagesOldestFirst([
        ...new Map(
          [...newMessages, ...(messagesQuery.data?.pages.flatMap((p) => p.items) ?? [])].map(
            (m) => [m.id, m],
          ),
        ).values(),
      ]),
    [messagesQuery.data, newMessages],
  );
  const latest = useQuery({
    queryKey: ["whatsapp-latest", actorScope, activeContactId],
    queryFn: () => listWhatsAppMessagePage({ data: { contactId: activeContactId!, limit: 50 } }),
    enabled: !!activeContactId && !!messagesQuery.data,
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const hasNew = latest.data?.items.some((m) => !messages.some((old) => old.id === m.id)) ?? false;
  useLayoutEffect(() => {
    const saved = anchor.current,
      node = transcript.current;
    if (saved && node) {
      node.scrollTop = saved.top + node.scrollHeight - saved.height;
      anchor.current = null;
    }
  }, [messages]);
  const choose = (id: string | undefined) => {
    setSelectedContactId(id);
    setNewMessages([]);
    anchor.current = null;
  };

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
          <input
            aria-label="Search all recorded conversations"
            value={q}
            maxLength={200}
            className="mt-3 min-h-11 w-full rounded border px-3"
            onChange={(e) => {
              setQ(e.target.value);
              choose(undefined);
            }}
          />
          <p className="mt-2 text-xs">
            已載入{conversations.length}個對話／共
            {conversationsQuery.data?.pages[0]?.total ?? "待確認"}個
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Configuration shows binding presence only. Connection health and live receipt
            verification remain unverified.
          </p>
        </div>

        {conversationsQuery.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(conversationsQuery.error)}
            <button
              className="min-h-11 px-3"
              onClick={() =>
                void (conversationsQuery.isFetchNextPageError
                  ? conversationsQuery.fetchNextPage()
                  : conversationsQuery.refetch())
              }
            >
              重試對話
            </button>
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
            <p className="font-medium">WhatsApp setup is incomplete</p>
            <p className="mt-1">
              Missing server bindings: {integrationQuery.data?.missingLiveEnvVars.join(", ")}.
              Existing recorded conversations remain visible; signed inbound and actual delivery
              need separate verification.
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
          <div className="border-b p-4 text-sm text-muted-foreground" role="status">
            <p>That conversation is no longer in this page of the inbox.</p>
            {/* Without this the notice is a dead end: selectedContactId is only
                otherwise reassigned by clicking a row, and the list may be empty. */}
            <button type="button" className="mt-1 underline" onClick={() => choose(undefined)}>
              Show the newest conversation
            </button>
          </div>
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
              onClick={() => choose(conversation.contactId)}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate font-medium">
                  {conversationContactLabel(conversation)}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {conversation.lastMessageAt
                    ? formatHongKongTimestamp(conversation.lastMessageAt)
                    : "尚未通訊"}
                </span>
              </div>
              <p className="mt-1 max-h-10 overflow-hidden text-sm text-muted-foreground">
                {conversation.lastMessageBody || "未有訊息紀錄"}
              </p>
              {conversation.companyName ? (
                <span className="mt-2 inline-flex rounded-full bg-secondary px-2 py-1 text-xs">
                  {conversation.companyName}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {conversationsQuery.hasNextPage ? (
          <button
            className="min-h-11 w-full border-t px-3"
            disabled={conversationsQuery.isFetching}
            onClick={() => void conversationsQuery.fetchNextPage()}
          >
            載入較早對話
          </button>
        ) : null}
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

            <div
              ref={transcript}
              role="log"
              aria-label="Recorded WhatsApp transcript"
              style={{ overflowAnchor: "none" }}
              className="max-h-[75vh] flex-1 space-y-3 overflow-y-auto p-6"
            >
              <p className="text-xs">
                已載入{messages.length}則／共
                {latest.data?.total ?? messagesQuery.data?.pages[0]?.total ?? "待確認"}則
              </p>
              {hasNew ? (
                <button
                  className="min-h-11 rounded border px-3"
                  onClick={() => setNewMessages((old) => [...(latest.data?.items ?? []), ...old])}
                >
                  有新訊息：載入最新記錄
                </button>
              ) : null}
              {messagesQuery.hasNextPage ? (
                <button
                  className="min-h-11 rounded border px-3"
                  disabled={messagesQuery.isFetching}
                  onClick={() => {
                    const node = transcript.current;
                    if (node) anchor.current = { height: node.scrollHeight, top: node.scrollTop };
                    void messagesQuery.fetchNextPage().catch(() => {
                      anchor.current = null;
                    });
                  }}
                >
                  載入更早訊息
                </button>
              ) : null}
              {messagesQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(messagesQuery.error)}
                  <button
                    className="min-h-11 px-3"
                    onClick={() =>
                      void (messagesQuery.isFetchNextPageError
                        ? messagesQuery.fetchNextPage()
                        : messagesQuery.refetch())
                    }
                  >
                    重試訊息
                  </button>
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
                  {/* A file the client actually sent. Until now the only trace
                      was a placeholder word in the body, so a client who typed
                      "[image]" and one who photographed their HKID produced the
                      same row -- and the media id was thrown away.
                      The bytes cannot be fetched: WOZTELL's webhook
                      documentation shows no media-download endpoint
                      (BLOCKED_INTEGRATION: whatsapp-media-download), so this
                      says what arrived and does not offer a download it cannot
                      honour. */}
                  {message.attachments.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {message.attachments.map((attachment) => (
                        <p
                          key={attachment.providerMediaId}
                          className="flex items-center gap-2 rounded bg-status-yellow-soft px-2 py-1 text-xs text-status-yellow"
                        >
                          <Paperclip aria-hidden className="h-3 w-3" />
                          客戶傳送了 {attachment.mediaType.toLowerCase()} 檔案
                          {attachment.hasDocument
                            ? "（已存檔）"
                            : "（待 mapping、受限下載及隔離收件）"}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {/* The draft is not always what went out. Outside WhatsApp's
                      24-hour window free-form text is forbidden, so a
                      zero-variable template is sent instead -- no company name,
                      no due date. Showing the draft alone let a staff member
                      believe the client had been told something they had not. */}
                  {message.direction === "inbound" ? (
                    <MessageIntake
                      messageId={message.id}
                      canManageMapping={integrationQuery.data?.canManageMapping === true}
                    />
                  ) : null}
                  {message.sentAs === "template" ? (
                    <p className="mt-2 rounded bg-status-yellow-soft px-2 py-1 text-xs text-status-yellow">
                      客戶收到的是範本訊息
                      {message.sentTemplateName ? `（${message.sentTemplateName}）` : ""}
                      ，不是上面這段文字。範本不含公司名稱或限期。
                    </p>
                  ) : null}
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
