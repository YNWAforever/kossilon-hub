import { readFileSync } from "node:fs";

import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { routeTree } from "../routeTree.gen";
import { getAnnualReturnCaseById, resetAnnualReturnCasesForTest } from "../lib/annual-return-store";
import {
  resetClientPortalStoreForTest,
  reviewClientDocument,
  uploadClientDocument,
} from "../lib/client-portal-store";

const annualReturnsRouteSource = readFileSync(
  new URL("./annual-returns.tsx", import.meta.url),
  "utf8",
);
const annualReturnDetailRouteSource = readFileSync(
  new URL("./annual-returns.$id.tsx", import.meta.url),
  "utf8",
);
const whatsappAutomationRouteSource = readFileSync(
  new URL("./whatsapp.automation.tsx", import.meta.url),
  "utf8",
);
const documentsRouteSource = readFileSync(new URL("./documents.tsx", import.meta.url), "utf8");
const portalRouteSource = readFileSync(new URL("./portal.tsx", import.meta.url), "utf8");

async function renderRoute(pathname: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: { queryClient: new QueryClient() },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

function seedRejectedPortalDocument() {
  resetAnnualReturnCasesForTest();
  resetClientPortalStoreForTest();

  const caseItem = getAnnualReturnCaseById("ar-delta");
  if (!caseItem) throw new Error("Missing fixture ar-delta");

  const upload = uploadClientDocument(
    caseItem,
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(reviewClientDocument(upload.documentId, "rejected", "Operations")).toEqual({
    ok: true,
    documentId: upload.documentId,
  });
}

describe("annual return workflow route regressions", () => {
  it("keeps the blockers column in the command center alongside packet and follow-up columns", () => {
    expect(annualReturnsRouteSource).toContain("<span>Blockers</span>");
    expect(annualReturnsRouteSource).toContain("<span>Packet</span>");
    expect(annualReturnsRouteSource).toContain("<span>Follow-ups</span>");
    expect(annualReturnsRouteSource).toContain('<Field label="Blockers" value={blockerSummary} />');
  });

  it("renders the annual-return detail route instead of swallowing it in the parent list route", async () => {
    const html = await renderRoute("/annual-returns/ar-delta");

    expect(html).toContain("Client portal activity");
    expect(html).toContain("Delta Bloom Ventures Limited");
    expect(html).not.toContain("Search company or contact");
  });

  it("renders an explicit status column in WhatsApp automation", () => {
    expect(whatsappAutomationRouteSource).toContain("<span>Status</span>");
    expect(whatsappAutomationRouteSource).toContain('label="Status"');
    expect(whatsappAutomationRouteSource).toContain("statusToneClass(draft.status)");
  });

  it("marks filed-case owner and notes controls as read-only in the detail view", () => {
    expect(annualReturnDetailRouteSource).toContain("disabled={isFiled}");
    expect(annualReturnDetailRouteSource).toContain("readOnly={isFiled}");
    expect(annualReturnDetailRouteSource).toContain("disabled={isFiled || !note.trim()}");
  });

  it("renders the client portal action center with mocked client actions", () => {
    expect(portalRouteSource).toContain('createFileRoute("/portal")');
    expect(portalRouteSource).toContain("caseId");
    expect(portalRouteSource).toContain("Upload");
    expect(portalRouteSource).toContain("Replace");
    expect(portalRouteSource).toContain("Acknowledge payment");
    expect(portalRouteSource).toContain("Approve packet");
    expect(portalRouteSource).toContain("View receipt");
  });

  it("keeps the portal and documents route contract aligned around case search and receipt access", () => {
    expect(documentsRouteSource).toContain('createFileRoute("/documents")');
    expect(documentsRouteSource).toContain("validateSearch");
    expect(documentsRouteSource).toContain("caseId");
    expect(portalRouteSource).toContain("search={{ caseId: selectedCase.id }}");
    expect(portalRouteSource).toContain('action.kind === "receipt"');
    expect(portalRouteSource).toContain('action.kind !== "receipt" && isReadOnly');
    expect(portalRouteSource).toContain('action.status !== "complete"');
  });

  it("renders rejected portal documents as replacements when the store marks them for replace", async () => {
    seedRejectedPortalDocument();

    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("Replace Signed NAR1");
    expect(html).toMatch(/Replace Signed NAR1[\s\S]*?>Replace<\/button>/);
  });

  it("renders the document archive with source, category, status, and case filters", () => {
    const documentsRouteSource = readFileSync(new URL("./documents.tsx", import.meta.url), "utf8");

    expect(documentsRouteSource).toContain('createFileRoute("/documents")');
    expect(documentsRouteSource).toContain("caseId");
    expect(documentsRouteSource).toContain("useEffect");
    expect(documentsRouteSource).toContain('setCaseFilter(caseId ?? "all")');
    expect(documentsRouteSource).toContain("Filter by source");
    expect(documentsRouteSource).toContain("Filter by category");
    expect(documentsRouteSource).toContain("Filter by status");
    expect(documentsRouteSource).toContain("getDocumentArchiveRows");
    expect(documentsRouteSource).toContain("Uploaded by");
    expect(documentsRouteSource).toContain("row.actor");
    expect(documentsRouteSource).toContain('to="/annual-returns/$id"');
  });

  it("connects annual-return detail and sidebar to portal activity", () => {
    const sidebarSource = readFileSync(
      new URL("../components/app-sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(annualReturnDetailRouteSource).toContain("Client portal activity");
    expect(annualReturnDetailRouteSource).toContain('to="/portal"');
    expect(annualReturnDetailRouteSource).toContain('to="/documents"');
    expect(annualReturnDetailRouteSource).toContain("getClientPortalRequiredActions");
    expect(annualReturnDetailRouteSource).toContain("getDocumentArchiveRows");
    expect(sidebarSource).toContain("Portal Demo");
    expect(sidebarSource).toContain('to: "/portal"');
  });
});
