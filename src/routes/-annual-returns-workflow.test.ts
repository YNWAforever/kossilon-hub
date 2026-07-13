import { readFileSync } from "node:fs";

import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/session")>();
  return {
    ...actual,
    getStoredSession: () => ({
      id: "test-admin",
      name: "Test Admin",
      email: "admin@example.com",
      role: "Admin",
      initials: "TA",
      team: "Operations",
      signedInAt: "2026-07-11T00:00:00.000Z",
    }),
  };
});

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-admin" }),
}));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  const session = {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@example.com",
    role: "Admin" as const,
    initials: "TA",
    team: "Operations",
    signedInAt: "2026-07-11T00:00:00.000Z",
  };

  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session,
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: true,
      login: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

import { routeTree } from "../routeTree.gen";
import {
  acceptFilingReceipt,
  completeChecklistItem,
  getAnnualReturnCaseById,
  resetAnnualReturnCasesForTest,
  submitFilingPacket,
  togglePacketRequirement,
  updatePaymentStatus,
  updateReviewStatus,
  updateSignatureStatus,
} from "../lib/annual-return-store";
import {
  acceptPaymentProof,
  attachPaymentProof,
  getClientPortalSnapshot,
  rejectPaymentProof,
  resetClientPortalStoreForTest,
  reviewClientDocument,
  sendDocumentReviewFollowUpNow,
  uploadClientDocument,
  uploadPaymentProof,
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
const paymentsRouteSource = readFileSync(new URL("./payments.tsx", import.meta.url), "utf8");
const aiAssistantPanelSource = readFileSync(
  new URL("../components/ai-assistant-panel.tsx", import.meta.url),
  "utf8",
);

async function renderRoute(pathname: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: { queryClient: new QueryClient(), dataMode: "production" },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

function requireCase(caseId: string) {
  const caseItem = getAnnualReturnCaseById(caseId);
  if (!caseItem) throw new Error(`Missing fixture ${caseId}`);
  return caseItem;
}

function seedRejectedPortalDocument() {
  resetAnnualReturnCasesForTest();
  resetClientPortalStoreForTest();

  const caseItem = requireCase("ar-delta");

  const upload = uploadClientDocument(caseItem, "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");

  expect(
    reviewClientDocument(upload.documentId, {
      decision: "rejected",
      reasonCode: "missing-signature",
      note: "Director signature is missing on page 2.",
      actor: "Operations",
    }),
  ).toEqual({
    ok: true,
    documentId: upload.documentId,
  });
}

function seedPendingReviewPortalDocument() {
  resetAnnualReturnCasesForTest();
  resetClientPortalStoreForTest();

  const caseItem = requireCase("ar-delta");

  const upload = uploadClientDocument(caseItem, "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
  if (!upload.ok) throw new Error("Expected fixture upload to succeed");
}

function makeDeltaReadyForReceipt() {
  const caseItem = requireCase("ar-delta");
  const signed = uploadClientDocument(caseItem, "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
  const scr = uploadClientDocument(caseItem, "scr", "updated-scr.pdf", "Joanna Poon");
  if (!signed.ok || !scr.ok) throw new Error("Expected fixture uploads to succeed");

  reviewClientDocument(signed.documentId, "accepted", "Operations");
  reviewClientDocument(scr.documentId, "accepted", "Operations");
  updatePaymentStatus("ar-delta", "paid");
  updateSignatureStatus("ar-delta", "received");
  completeChecklistItem("ar-delta", "collect-signed-nar1");
  completeChecklistItem("ar-delta", "verify-scr");
  completeChecklistItem("ar-delta", "confirm-payment");
  completeChecklistItem("ar-delta", "submit-registry");
  updateReviewStatus("ar-delta", "approved");

  for (const requirementId of [
    "nar1-draft",
    "company-particulars",
    "scr-confirmed",
    "signed-nar1-attached",
    "payment-proof-checked",
    "internal-filing-review",
  ]) {
    if (
      !requireCase("ar-delta").packetRequirements.find((item) => item.id === requirementId)
        ?.complete
    ) {
      togglePacketRequirement("ar-delta", requirementId);
    }
  }
}

describe("annual return workflow route regressions", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();
  });

  it("renders the operational workflow routes in labeled desktop and mobile root navigation", async () => {
    const html = await renderRoute("/portal?caseId=ar-delta");
    const desktopNavigation = html.match(
      /<nav[^>]*aria-label="Primary navigation"[^>]*>[\s\S]*?<\/nav>/,
    )?.[0];
    const mobileNavigation = html.match(
      /<nav[^>]*aria-label="Operational navigation"[^>]*>[\s\S]*?<\/nav>/,
    )?.[0];

    expect(desktopNavigation).toBeDefined();
    expect(mobileNavigation).toBeDefined();

    for (const [path, label] of [
      ["/portal", "Portal"],
      ["/payments", "Payments"],
      ["/whatsapp/automation", "Automation"],
      ["/annual-returns", "Annual returns"],
    ]) {
      expect(desktopNavigation).toContain(`href="${path}"`);
      expect(mobileNavigation).toContain(`href="${path}"`);
      expect(mobileNavigation).toContain(`>${label}</a>`);
    }

    expect(desktopNavigation?.indexOf('href="/portal"')).toBeLessThan(
      desktopNavigation?.indexOf('href="/whatsapp/automation"') ?? -1,
    );
    expect(desktopNavigation).toContain(">Portal</span>");
    expect(desktopNavigation).toContain(">WhatsApp Automation</span>");
    expect(mobileNavigation).toContain("border-border");
    expect(mobileNavigation).toContain("gap-2");
  });

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

  it("renders the root not-found state for an unknown client id", async () => {
    const html = await renderRoute("/clients/missing-client");

    expect(html).toContain("Page not found");
    expect(html).not.toContain("Aurora Peak Trading Limited");
  });

  it("renders the restored client directory and operational filters", async () => {
    const html = await renderRoute("/clients");

    expect(html).toContain("companies under management");
    expect(html).toContain("Search clients");
    expect(html).toContain("All packages");
    expect(html).toContain("All teams");
    expect(html).toContain("Harbour Trading Ltd");
    expect(html).toContain("60000000");
  });

  it("renders the restored client profile without routing an unmapped client to another portal case", async () => {
    const html = await renderRoute("/clients/c-1");

    expect(html).toContain("Harbour Trading Ltd");
    expect(html).toContain("Contacts");
    expect(html).toContain("Annual return history");
    expect(html).toContain("Documents");
    expect(html).toContain("Payment");
    expect(html).toContain("Company timeline");
    expect(html).toContain("Open board");
    expect(html).not.toContain(">Open portal</a>");
  });

  it("renders the restored enquiry conversation, triage, conversion, and AI drafting workflow", async () => {
    const html = await renderRoute("/enquiries");

    expect(html).toContain("Enquiry Inbox");
    expect(html).toContain("Search conversations");
    expect(html).toContain("AI triage");
    expect(html).toContain("Convert to client");
    expect(html).toContain("Send quote");
    expect(html).toContain("Type a message");
    expect(html).toContain("AI draft available");
  });

  it("marks only WhatsApp Automation active on its nested route", async () => {
    const html = await renderRoute("/whatsapp/automation");
    const navigation = html.match(
      /<nav[^>]*aria-label="Primary navigation"[^>]*>[\s\S]*?<\/nav>/,
    )?.[0];
    const inboxLink = navigation?.match(/<a[^>]*href="\/whatsapp"[^>]*>/)?.[0];
    const automationLink = navigation?.match(/<a[^>]*href="\/whatsapp\/automation"[^>]*>/)?.[0];

    expect(inboxLink).toBeDefined();
    expect(automationLink).toBeDefined();
    expect(inboxLink).not.toContain('data-status="active"');
    expect(inboxLink).not.toContain("bg-sidebar-accent text-sidebar-accent-foreground");
    expect(automationLink).toContain('data-status="active"');
    expect(automationLink).toContain("bg-sidebar-accent text-sidebar-accent-foreground");
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
  });

  it("renders payment proof attachment and review controls", async () => {
    const htmlWithoutProof = await renderRoute("/payments");
    expect(htmlWithoutProof).toContain("Attach proof");

    attachPaymentProof(requireCase("ar-delta"), "fps-proof.png", "Operations");
    const htmlWithProof = await renderRoute("/payments");
    expect(htmlWithProof).toContain("fps-proof.png");
    expect(htmlWithProof).toContain("Accept");
    expect(htmlWithProof).toContain("Reject");
  });

  it("renders only the replacement action for rejected payment proof", async () => {
    const upload = attachPaymentProof(requireCase("ar-delta"), "fps-proof.png", "Operations");
    if (!upload.ok) throw new Error("Expected payment proof attachment to succeed");

    expect(
      rejectPaymentProof(upload.proofId, {
        reasonCode: "unreadable",
        actor: "Operations",
      }),
    ).toEqual({ ok: true, proofId: upload.proofId });

    const html = await renderRoute("/payments");

    expect(html).toContain(
      'aria-label="Attach replacement payment proof for Delta Bloom Ventures Limited"',
    );
    expect(html).not.toContain(
      'aria-label="Attach payment proof for Delta Bloom Ventures Limited"',
    );
  });

  it("does not render attachment actions for accepted payment proof", async () => {
    const upload = attachPaymentProof(requireCase("ar-delta"), "fps-proof.png", "Operations");
    if (!upload.ok) throw new Error("Expected payment proof attachment to succeed");

    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });

    const html = await renderRoute("/payments");

    expect(html).not.toContain(
      'aria-label="Attach payment proof for Delta Bloom Ventures Limited"',
    );
    expect(html).not.toContain(
      'aria-label="Attach replacement payment proof for Delta Bloom Ventures Limited"',
    );
  });

  it("disables attachment controls for a filed case without payment proof", async () => {
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const html = await renderRoute("/payments");

    expect(html).toMatch(
      /aria-label="Attach payment proof for Delta Bloom Ventures Limited"[^>]*disabled/,
    );
  });

  it("disables payment proof review controls after receipt acceptance", async () => {
    const upload = attachPaymentProof(requireCase("ar-delta"), "fps-proof.png", "Operations");
    if (!upload.ok) throw new Error("Expected payment proof attachment to succeed");

    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const html = await renderRoute("/payments");

    expect(html).toMatch(
      /aria-label="Accept payment proof for Delta Bloom Ventures Limited"[^>]*disabled/,
    );
    expect(html).toMatch(
      /aria-label="Reject payment proof for Delta Bloom Ventures Limited"[^>]*disabled/,
    );
  });

  it("keeps structured payment proof reasons and client-visible notes in the payments route", () => {
    expect(paymentsRouteSource).toContain("clientPortalPaymentProofReviewReasons");
    expect(paymentsRouteSource).toContain("Client-visible note");
    expect(paymentsRouteSource).toContain(
      "Production payment proof review uses the annual-return server action.",
    );
    expect(paymentsRouteSource).not.toContain("acceptPaymentProof(");
    expect(paymentsRouteSource).not.toContain("rejectPaymentProof(");
    expect(paymentsRouteSource).toContain(
      "aria-label={`Confirm payment proof rejection for ${caseItem.companyName}`}",
    );
  });

  it("renders the selected portal case from the case search parameter", async () => {
    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("Delta Bloom Ventures Limited");
    expect(html).toContain("Upload Signed NAR1");
    expect(html).toContain("Acknowledge payment");
    expect(html).toContain("Approve packet");
  });

  it("renders the portal not-found state for an unknown case search parameter", async () => {
    const html = await renderRoute("/portal?caseId=missing-case");

    expect(html).toContain("Portal case not found");
    expect(html).not.toContain("Delta Bloom Ventures Limited");
  });

  it("renders document archive review controls for pending client uploads", async () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");

    const html = await renderRoute("/documents?caseId=ar-delta");

    expect(html).toContain("Delta Bloom Ventures Limited");
    expect(html).toContain("signed-nar1.pdf");
    expect(html).toContain('aria-label="Accept Signed NAR1"');
    expect(html).toContain('aria-label="Reject Signed NAR1"');
  });

  it("keeps structured rejection controls in the documents route source", () => {
    expect(documentsRouteSource).toContain("clientPortalReviewReasons");
    expect(documentsRouteSource).toContain("Rejection reason");
    expect(documentsRouteSource).toContain("Optional review note");
  });

  it("renders document archive review metadata after staff review", async () => {
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");

    reviewClientDocument(upload.documentId, "accepted", "Operations");
    const html = await renderRoute("/documents?caseId=ar-delta");
    const reviewedDocument = getClientPortalSnapshot().documents.find(
      (document) => document.id === upload.documentId,
    );
    if (!reviewedDocument?.reviewedAt) throw new Error("Expected reviewed timestamp to exist");
    const reviewedAt = new Date(reviewedDocument.reviewedAt).toLocaleString("en-HK", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    expect(html).toContain("Reviewed by Operations");
    expect(html).toContain(reviewedAt);
    expect(html).toContain("signed-nar1.pdf");
    expect(html).not.toContain('aria-label="Accept Signed NAR1"');
    expect(html).not.toContain('aria-label="Reject Signed NAR1"');
  });

  it("renders rejected portal documents as replacements when the store marks them for replace", async () => {
    seedRejectedPortalDocument();

    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("Replace Signed NAR1");
    expect(html).toMatch(/Replace Signed NAR1[\s\S]*?>Replace<\/button>/);
    expect(html.match(/>Replace<\/button>/g) ?? []).toHaveLength(1);
  });

  it("renders rejected document reason and note in the client portal", async () => {
    seedRejectedPortalDocument();

    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("Replace Signed NAR1");
    expect(html).toContain("Required signature is missing");
    expect(html).toContain("Director signature is missing on page 2.");
    expect(html).toContain("Please upload a replacement");
  });

  it("renders rejected payment proof reason, replacement action, and history", async () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "blurred.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    rejectPaymentProof(upload.proofId, {
      reasonCode: "unreadable",
      note: "The transfer reference is cropped.",
      actor: "Operations",
    });

    const html = await renderRoute("/portal?caseId=ar-delta");
    expect(html).toContain("Replace payment proof");
    expect(html).toContain("Proof is unclear, cropped, or incomplete");
    expect(html).toContain("The transfer reference is cropped.");
    expect(html).toContain("Payment proof history");
  });

  it("keeps accepted payment proof review metadata and history visible after receipt acceptance", async () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "accepted-proof.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    expect(acceptPaymentProof(upload.proofId, "Operations")).toEqual({
      ok: true,
      proofId: upload.proofId,
    });
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const proof = getClientPortalSnapshot().paymentProofs.find(
      (item) => item.id === upload.proofId,
    );
    if (!proof?.reviewedAt) throw new Error("Expected payment proof review timestamp");
    const reviewedAt = new Date(proof.reviewedAt).toLocaleString("en-HK", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("Payment proof history");
    expect(html).toContain("accepted-proof.png");
    expect(html).toContain("Reviewed by");
    expect(html).toContain("Operations");
    expect(html).toContain(reviewedAt);
  });

  it("does not render replace controls for accepted portal documents", async () => {
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");
    expect(reviewClientDocument(upload.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: upload.documentId,
    });

    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("signed-nar1.pdf has been accepted by staff.");
    expect(html).not.toContain("Replace Signed NAR1");
    expect(html).not.toMatch(/Signed NAR1[\s\S]*?>Replace<\/button>/);
  });

  it("renders accepted document review metadata in the client portal", async () => {
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");
    expect(
      reviewClientDocument(upload.documentId, {
        decision: "accepted",
        actor: "Operations",
      }),
    ).toEqual({
      ok: true,
      documentId: upload.documentId,
    });

    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("signed-nar1.pdf has been accepted by staff.");
    expect(html).toContain("Accepted by Operations");
  });

  it("does not render document review controls for pending uploads once the case receipt is accepted", async () => {
    makeDeltaReadyForReceipt();
    resetClientPortalStoreForTest();
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1-pending.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const html = await renderRoute("/documents?caseId=ar-delta");

    expect(html).toContain("signed-nar1-pending.pdf");
    expect(html).not.toContain('aria-label="Accept Signed NAR1"');
    expect(html).not.toContain('aria-label="Reject Signed NAR1"');
  });

  it("does not render an actionable Upload button for pending-review portal documents", async () => {
    seedPendingReviewPortalDocument();

    const html = await renderRoute("/portal?caseId=ar-delta");

    expect(html).toContain("Signed NAR1");
    expect(html).toContain("waiting for staff review");
    expect(html).not.toContain('aria-label="Upload Signed NAR1"');
    expect(html).not.toContain("Replace Signed NAR1");
  });

  it("renders rejected-document drafts in WhatsApp automation", async () => {
    seedRejectedPortalDocument();

    const html = await renderRoute("/whatsapp/automation");

    expect(html).toContain("Delta Bloom Ventures Limited");
    expect(html).toContain("Document replacement");
    expect(html).toContain("Required signature is missing");
    expect(html).toContain("Director signature is missing on page 2.");
    expect(html).toContain("Send now");
  });

  it("renders rejected payment proof drafts in WhatsApp automation", async () => {
    const upload = uploadPaymentProof(requireCase("ar-delta"), "proof.png", "Joanna Poon");
    if (!upload.ok) throw new Error("Expected proof upload");
    rejectPaymentProof(upload.proofId, {
      reasonCode: "missing-reference",
      note: "Please include the FPS reference.",
      actor: "Operations",
    });

    const html = await renderRoute("/whatsapp/automation");
    expect(html).toContain("Payment proof replacement");
    expect(html).toContain("Transaction reference is missing");
    expect(html).toContain("Please include the FPS reference.");
    expect(html).toContain("Send now");
  });

  it("exposes payment proof state to AI without state-changing controls", () => {
    expect(aiAssistantPanelSource).toContain("getPaymentProofAiContext");
    expect(aiAssistantPanelSource).toContain("Payment proof");
    expect(aiAssistantPanelSource).not.toContain("acceptPaymentProof(");
    expect(aiAssistantPanelSource).not.toContain("rejectPaymentProof(");
    expect(aiAssistantPanelSource).not.toContain("sendPaymentProofFollowUpNow(");
  });

  it("keeps sent rejected-document drafts out of the default Open WhatsApp queue", async () => {
    seedRejectedPortalDocument();
    const rejectedDocument = getClientPortalSnapshot().documents.find(
      (document) => document.status === "rejected",
    );
    if (!rejectedDocument) throw new Error("Expected rejected document fixture");

    expect(
      sendDocumentReviewFollowUpNow(
        `document-review-follow-up-${rejectedDocument.id}`,
        "Operations",
      ),
    ).toEqual({ ok: true });

    const html = await renderRoute("/whatsapp/automation");

    expect(html).not.toContain("Document replacement");
    expect(html).not.toContain("Required signature is missing");
    expect(html).not.toContain("Director signature is missing on page 2.");
  });

  it("keeps the Sent WhatsApp queue filter wired to sent follow-ups in source", () => {
    expect(whatsappAutomationRouteSource).toContain(
      'if (filter === "open") return draft.status === "draft";',
    );
    expect(whatsappAutomationRouteSource).toContain(
      'if (filter === "sent") return draft.status === "sent";',
    );
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
    expect(sidebarSource).toContain('label: "Portal"');
    expect(sidebarSource).toContain('to: "/portal"');
  });

  it("shows persisted work-item owner and SLA state in annual-return routes", () => {
    expect(annualReturnsRouteSource).toContain("listWorkQueue");
    expect(annualReturnsRouteSource).toContain("Work owner");
    expect(annualReturnsRouteSource).toContain("SLA state");
    expect(annualReturnDetailRouteSource).toContain("listWorkQueue");
    expect(annualReturnDetailRouteSource).toContain("Work owner");
    expect(annualReturnDetailRouteSource).toContain("SLA state");
  });
});
