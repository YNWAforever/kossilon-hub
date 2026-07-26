import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { ConvertToClientDialog } from "@/components/convert-to-client-dialog";
import { AiAssistantPanel } from "@/components/ai-assistant-panel";
import { enquiries, formatDateTime, teamMembers } from "@/lib/mock-data";
import { useEnquiryConversion } from "@/lib/clients-store";
import {
  UserPlus,
  Send,
  Paperclip,
  CheckCircle2,
  Sparkles,
  AlertTriangle,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sortEnquiriesByTriage, triageEnquiry, triageTone } from "@/lib/enquiry-triage";

type SearchParams = { enquiry?: string };

export const Route = createFileRoute("/enquiries")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    enquiry: typeof s.enquiry === "string" ? s.enquiry : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Enquiries — Kossilon CoSec OS" },
      {
        name: "description",
        content:
          "WhatsApp enquiries with AI intent classification, quote status, and staff assignment.",
      },
    ],
  }),
  component: EnquiriesPage,
});

function EnquiriesPage() {
  const router = useRouter();
  const { enquiry: enquiryParam } = Route.useSearch();
  const triageRows = useMemo(
    () =>
      sortEnquiriesByTriage(enquiries).map((enquiry) => ({
        enquiry,
        triage: triageEnquiry(enquiry),
      })),
    [],
  );
  const triageCounts = useMemo(
    () =>
      triageRows.reduce(
        (counts, row) => {
          counts[row.triage.band] += 1;
          return counts;
        },
        { urgent: 0, priority: 0, watch: 0, routine: 0 },
      ),
    [triageRows],
  );
  const initial =
    enquiries.find((e) => e.id === enquiryParam)?.id ??
    triageRows[0]?.enquiry.id ??
    enquiries[0].id;
  const [selected, setSelected] = useState(initial);
  const [convertOpen, setConvertOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const active = enquiries.find((e) => e.id === selected)!;
  const activeTriage = useMemo(() => triageEnquiry(active), [active]);
  const assignee = teamMembers.find((t) => t.id === active.assignedTo);
  const convertedClientId = useEnquiryConversion(active.id);

  // Sync when URL search param changes (e.g. deep link from case detail)
  useEffect(() => {
    if (enquiryParam && enquiries.find((e) => e.id === enquiryParam)) {
      setSelected(enquiryParam);
    }
  }, [enquiryParam]);

  // Reset composer when switching threads
  useEffect(() => {
    setComposerText("");
  }, [selected]);

  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <PageHeader
            eyebrow="Messaging"
            title="Enquiry Inbox"
            subtitle={`${enquiries.length} conversations · ${enquiries.reduce((s, e) => s + e.unread, 0)} unread`}
          />
        </div>
        {/* The three panes scroll independently, so they get their own row. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Conversation list */}
          <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-card">
            <div className="border-b border-border p-3">
              <input
                placeholder="Search conversations…"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-status-red" />
                  {triageCounts.urgent} urgent
                </span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-status-orange" />
                  {triageCounts.priority} priority
                </span>
              </div>
            </div>
            <ul>
              {triageRows.map(({ enquiry: e, triage }) => {
                const isActive = e.id === selected;
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelected(e.id)}
                      className={cn(
                        "w-full border-b border-border p-3 text-left transition hover:bg-muted/40",
                        isActive && "bg-accent",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">{e.contactName}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDateTime(e.lastMessageAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {e.lastMessage}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StatusPill
                          tone={triageTone(triage.band)}
                          className="!py-0.5 !text-[10px] capitalize"
                        >
                          {triage.band}
                        </StatusPill>
                        <StatusPill tone="blue" className="!py-0.5 !text-[10px]">
                          {e.intent}
                        </StatusPill>
                        {e.unread > 0 && (
                          <span className="rounded-full bg-status-green px-1.5 text-[10px] font-semibold text-white">
                            {e.unread}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {triage.routeTeam} · {(triage.confidence * 100).toFixed(0)}%
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Thread */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border bg-background px-5 py-3">
              <div>
                <p className="font-display text-base font-semibold text-foreground">
                  {active.contactName}
                </p>
                <p className="text-xs text-muted-foreground">{active.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={triageTone(activeTriage.band)} className="capitalize">
                  {activeTriage.band}
                </StatusPill>
                {convertedClientId ? (
                  <Link
                    to="/clients/$id"
                    params={{ id: convertedClientId }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-status-green/30 bg-status-green-soft px-3 py-1.5 text-xs font-medium text-foreground hover:bg-status-green-soft/80"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-status-green" /> View client →
                  </Link>
                ) : (
                  <button
                    onClick={() => setConvertOpen(true)}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <UserPlus className="h-3.5 w-3.5" /> Convert to client
                    </span>
                  </button>
                )}
                <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                  Send quote
                </button>
              </div>
            </div>

            <div className="border-b border-border bg-muted/30 px-5 py-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      AI triage
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {activeTriage.intent} · {activeTriage.routeTeam} ·{" "}
                      {(activeTriage.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {activeTriage.recommendedAction}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeTriage.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {active.messages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex", m.from === "staff" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-md rounded-2xl px-4 py-2 text-sm",
                      m.from === "staff"
                        ? "bg-primary text-primary-foreground"
                        : m.from === "bot"
                          ? "bg-status-blue-soft text-foreground ring-1 ring-status-blue/20"
                          : "bg-card text-foreground ring-1 ring-border",
                    )}
                  >
                    {m.from === "bot" && (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-status-blue">
                        AI assistant
                      </p>
                    )}
                    {m.text}
                    <p
                      className={cn(
                        "mt-1 text-[10px]",
                        m.from === "staff" ? "text-primary-foreground/70" : "text-muted-foreground",
                      )}
                    >
                      {formatDateTime(m.at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border bg-card p-3">
              <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
                <button
                  className="p-2 text-muted-foreground hover:text-foreground"
                  aria-label="Attach"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  rows={2}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  placeholder="Type a message… or use the AI draft →"
                  className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  onClick={() => {
                    if (!composerText.trim()) return;
                    toast.success("Reply sent");
                    setComposerText("");
                  }}
                  className="rounded-md bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-primary" /> AI draft available in the right
                  panel
                </span>
                <span>
                  Intent: {activeTriage.intent} · {(activeTriage.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </section>

          <AiAssistantPanel
            enquiry={active}
            onInsert={(text) => setComposerText(text)}
            onSend={() => setComposerText("")}
          />
        </div>
      </main>
      {/* Assignee sr-only reference to keep type usage explicit */}
      <span className="sr-only">{assignee?.name}</span>

      <ConvertToClientDialog
        enquiry={convertOpen ? active : null}
        open={convertOpen}
        onOpenChange={setConvertOpen}
        onConverted={(company) => {
          toast.success(`${company.name} added to clients`, {
            description: `Owner: ${teamMembers.find((t) => t.id === company.ownerId)?.name}`,
            action: {
              label: "Open",
              onClick: () => router.navigate({ to: "/clients/$id", params: { id: company.id } }),
            },
          });
        }}
      />
    </>
  );
}
