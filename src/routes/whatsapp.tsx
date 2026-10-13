import { useMemo, useState } from "react";
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";

import { AiAssistantPanel } from "../components/ai-assistant-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProductionWhatsAppInbox } from "../features/whatsapp/components/production-inbox";
import {
  enquiries,
  enquiryIntentLabels,
  enquiryStatusLabels,
  findClientForEnquiry,
} from "../lib/app-data";

export const Route = createFileRoute("/whatsapp")({
  // `enquiry` addresses a demo fixture. Production conversations are keyed by
  // whatsapp_contacts.id and are selected in-page, so it is ignored there.
  validateSearch: (search: Record<string, unknown>) => ({
    enquiry: typeof search.enquiry === "string" ? search.enquiry : undefined,
  }),
  component: WhatsAppRoute,
});

function WhatsAppRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();

  // Must stay above the data-mode branch: /whatsapp/automation renders through
  // this Outlet, and a branch that returns a screen unconditionally would blank it.
  if (pathname !== "/whatsapp") {
    return <Outlet />;
  }

  return dataMode === "demo" ? <DemoWhatsAppInbox /> : <ProductionWhatsAppInbox />;
}

function DemoWhatsAppInbox() {
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
    <main className="grid min-h-screen lg:grid-cols-[320px_minmax(0,1fr)_420px]">
      <section className="border-r bg-card">
        {/* The conversation rail is this screen's header — an inbox has no room
            for a page title above it, so PageHeader sits inside the rail. */}
        <div className="border-b p-4">
          <PageHeader eyebrow="通訊" title="WhatsApp 收件箱" />
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
                {enquiryIntentLabels[enquiry.intent]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-h-screen flex-col">
        <div className="border-b p-4">
          <div>
            <h2 className="text-xl font-semibold">{selected.name}</h2>
            <p className="text-sm text-muted-foreground">
              {selected.phone} · {enquiryStatusLabels[selected.status]}
            </p>
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
            <p className="mb-3 rounded-md bg-status-blue-soft px-3 py-2 text-sm text-status-blue-text">
              {notice}
            </p>
          ) : null}
          <textarea
            className="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="輸入回覆，或插入 AI 草稿…"
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <Button onClick={() => showNotice("已開啟 AI 草稿面板")}>AI</Button>
            <Button
              variant="primary"
              onClick={() => {
                setComposer("");
                showNotice("示範回覆已發送");
              }}
            >
              發送回覆
            </Button>
          </div>
        </div>
      </section>

      <div className="border-l bg-background p-4">
        <AiAssistantPanel
          enquiry={selected}
          clientCase={clientCase}
          onInsert={(draft) => {
            setComposer(draft);
            showNotice("草稿已插入輸入框");
          }}
          onSend={(draft) => {
            setComposer(draft);
            showNotice("示範 AI 回覆已發送");
          }}
        />
      </div>
    </main>
  );
}
