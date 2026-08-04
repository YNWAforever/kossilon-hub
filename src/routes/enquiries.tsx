import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { ConvertToClientDialog } from "@/components/convert-to-client-dialog";
import { AiAssistantPanel } from "@/components/ai-assistant-panel";
import { enquiries, formatDateTime, teamMembers } from "@/lib/mock-data";
import { UserPlus, Send, Paperclip, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const { enquiry: enquiryParam } = Route.useSearch();
  const initial = enquiries.find((e) => e.id === enquiryParam)?.id ?? enquiries[0].id;
  const [selected, setSelected] = useState(initial);
  const [convertOpen, setConvertOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const active = enquiries.find((e) => e.id === selected)!;
  const assignee = teamMembers.find((t) => t.id === active.assignedTo);

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
      <TopBar
        title="Enquiry Inbox"
        subtitle={`${enquiries.length} conversations · ${enquiries.reduce((s, e) => s + e.unread, 0)} unread`}
      />
      <main className="flex flex-1 overflow-hidden">
        {/* Conversation list */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-card">
          <div className="border-b border-border p-3">
            <input
              placeholder="Search conversations…"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <ul>
            {enquiries.map((e) => {
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
                    <div className="mt-2 flex items-center gap-1.5">
                      <StatusPill tone="blue" className="!py-0.5 !text-[10px]">
                        {e.intent}
                      </StatusPill>
                      {e.unread > 0 && (
                        <span className="rounded-full bg-status-green px-1.5 text-[10px] font-semibold text-white">
                          {e.unread}
                        </span>
                      )}
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
              <button
                onClick={() => setConvertOpen(true)}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <span className="inline-flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" /> Convert to client
                </span>
              </button>
              <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                Send quote
              </button>
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
                <Sparkles className="h-3 w-3 text-primary" /> AI draft available in the right panel
              </span>
              <span>
                Intent: {active.intent} · {(active.intentConfidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </section>

        <AiAssistantPanel
          enquiry={active}
          onInsert={(text) => setComposerText(text)}
          onSend={() => setComposerText("")}
        />
      </main>
      {/* Assignee sr-only reference to keep type usage explicit */}
      <span className="sr-only">{assignee?.name}</span>

      <ConvertToClientDialog
        enquiry={convertOpen ? active : null}
        open={convertOpen}
        onOpenChange={setConvertOpen}
      />
    </>
  );
}
