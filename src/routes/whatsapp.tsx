import { createFileRoute, Link } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { Zap, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp Inbox — Kossilon CoSec OS" },
      { name: "description", content: "Two-way WhatsApp conversations with clients, template picker, and AI intent classification." },
    ],
  }),
  component: WhatsAppInboxPage,
});

function WhatsAppInboxPage() {
  return (
    <>
      <TopBar
        title="WhatsApp Inbox"
        subtitle="Two-way conversations with clients via WOZTELL"
        actions={
          <Link to="/whatsapp/automation" className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            <Zap className="h-3.5 w-3.5" /> Automation
          </Link>
        }
      />
      <main className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-status-green-soft">
            <MessageCircle className="h-7 w-7 text-status-green" />
          </div>
          <h2 className="mt-4 font-display text-xl font-semibold text-foreground">Manage WhatsApp threads in Enquiries</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The unified inbox lives on the Enquiries page — every client message is threaded there with AI-classified intent, quote status, and staff assignment.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link to="/enquiries" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Open Enquiries
            </Link>
            <Link to="/whatsapp/automation" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent">
              Configure automation
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
