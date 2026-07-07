import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { AiAssistantPanel } from "../components/ai-assistant-panel";
import { enquiries, findClientForEnquiry } from "../lib/app-data";

export const Route = createFileRoute("/whatsapp")({
  validateSearch: (search: Record<string, unknown>) => ({
    enquiry: typeof search.enquiry === "string" ? search.enquiry : undefined,
  }),
  component: WhatsAppRoute,
});

function WhatsAppRoute() {
  const search = Route.useSearch();
  const initialId =
    search.enquiry && enquiries.some((enquiry) => enquiry.id === search.enquiry)
      ? search.enquiry
      : (enquiries[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState(initialId);
  const [composer, setComposer] = useState("");
  const [notice, setNotice] = useState<string | undefined>();
  const selected = enquiries.find((enquiry) => enquiry.id === selectedId) ?? enquiries[0];
  const clientCase = useMemo(
    () => (selected ? findClientForEnquiry(selected) : undefined),
    [selected],
  );

  if (!selected) return null;

  function showNotice(message: string): void {
    setNotice(message);
    window.setTimeout(() => setNotice(undefined), 2200);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[320px_minmax(0,1fr)_420px]">
      <section className="border-r bg-card">
        <div className="border-b p-4">
          <p className="text-sm font-medium text-muted-foreground">Inbox</p>
          <h1 className="mt-1 text-2xl font-semibold">WhatsApp</h1>
        </div>
        <div className="divide-y">
          {enquiries.map((enquiry) => (
            <button
              key={enquiry.id}
              className={`w-full px-4 py-3 text-left hover:bg-muted ${selected.id === enquiry.id ? "bg-muted" : ""}`}
              onClick={() => {
                setSelectedId(enquiry.id);
                setComposer("");
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{enquiry.name}</p>
                <span className="text-xs text-muted-foreground">{enquiry.lastMessageAt}</span>
              </div>
              <p className="mt-1 max-h-10 overflow-hidden text-sm text-muted-foreground">
                {enquiry.lastMessage}
              </p>
              <span className="mt-2 inline-flex rounded-full bg-secondary px-2 py-1 text-xs">
                {enquiry.intent}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-h-screen flex-col">
        <div className="border-b p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{selected.name}</h2>
              <p className="text-sm text-muted-foreground">
                {selected.phone} - {selected.status}
              </p>
            </div>
            {clientCase ? (
              <Link
                className="rounded-md border px-3 py-2 text-sm"
                to="/clients/$id"
                params={{ id: clientCase.id }}
              >
                Client
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex-1 space-y-4 p-6">
          <div className="max-w-xl rounded-lg bg-status-green-soft p-4 text-sm">
            <p>{selected.lastMessage}</p>
            <p className="mt-2 text-xs text-muted-foreground">{selected.lastMessageAt}</p>
          </div>
        </div>

        <div className="border-t bg-card p-4">
          {notice ? (
            <p className="mb-3 rounded-md bg-status-blue-soft px-3 py-2 text-sm text-status-blue">
              {notice}
            </p>
          ) : null}
          <textarea
            className="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Type a reply or insert an AI draft..."
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              className="rounded-md border px-3 py-2 text-sm"
              onClick={() => showNotice("AI draft panel is open")}
            >
              AI
            </button>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => {
                setComposer("");
                showNotice("Mock reply sent");
              }}
            >
              Send reply
            </button>
          </div>
        </div>
      </section>

      <div className="border-l bg-background p-4">
        <AiAssistantPanel
          enquiry={selected}
          clientCase={clientCase}
          onInsert={(draft) => {
            setComposer(draft);
            showNotice("Draft inserted into composer");
          }}
          onSend={(draft) => {
            setComposer(draft);
            showNotice("Mock AI reply sent");
          }}
        />
      </div>
    </div>
  );
}
