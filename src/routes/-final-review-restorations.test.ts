import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const rootRouteSource = readFileSync(new URL("./__root.tsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(
  new URL("../components/app-sidebar.tsx", import.meta.url),
  "utf8",
);
const startSource = readFileSync(new URL("../start.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./settings.tsx", import.meta.url), "utf8");
const teamsSource = readFileSync(new URL("./teams.tsx", import.meta.url), "utf8");
const clientDetailSource = readFileSync(new URL("./clients.$id.tsx", import.meta.url), "utf8");
const clientsSource = readFileSync(new URL("./clients.tsx", import.meta.url), "utf8");
const enquiriesSource = readFileSync(new URL("./enquiries.tsx", import.meta.url), "utf8");
const knowledgeBaseSectionSource = readFileSync(
  new URL("../components/knowledge-base-section.tsx", import.meta.url),
  "utf8",
);

describe("final review architecture restorations", () => {
  it("keeps the authenticated query-backed root shell and error boundaries wired", () => {
    expect(rootRouteSource).toContain("createRootRouteWithContext<{ queryClient: QueryClient }>()");
    expect(rootRouteSource).toContain("beforeLoad: ({ location }) =>");
    expect(rootRouteSource).toContain("isPublicRoute(location.pathname)");
    expect(rootRouteSource).toContain("getStoredSession()");
    expect(rootRouteSource).toContain("throw redirect({");
    expect(rootRouteSource).toContain("<QueryClientProvider client={queryClient}>");
    expect(rootRouteSource).toContain("<AuthProvider>");
    expect(rootRouteSource).toContain("<ProtectedAppShell />");
    expect(rootRouteSource).toContain("<Toaster />");
    expect(rootRouteSource).toContain("notFoundComponent: NotFoundComponent");
    expect(rootRouteSource).toContain("errorComponent: ErrorComponent");
    expect(rootRouteSource).toContain('import appCss from "../styles.css?url"');
    expect(rootRouteSource).toContain('{ rel: "stylesheet", href: appCss }');
    expect(rootRouteSource).toContain("Kossilon CoSec OS");
  });

  it("exposes the operational routes in labeled desktop and mobile navigation", () => {
    expect(sidebarSource).toContain('<nav aria-label="Primary navigation"');
    expect(rootRouteSource).toContain('aria-label="Operational navigation"');

    for (const [path, desktopLabel, mobileLabel] of [
      ["/portal", "Portal", "Portal"],
      ["/payments", "Payments", "Payments"],
      ["/whatsapp/automation", "WhatsApp Automation", "Automation"],
      ["/annual-returns", "Annual Returns", "Annual returns"],
    ]) {
      expect(sidebarSource).toContain(`{ to: "${path}", label: "${desktopLabel}"`);
      expect(rootRouteSource).toContain(`{ to: "${path}", label: "${mobileLabel}" }`);
    }

    expect(sidebarSource.indexOf('to: "/portal"')).toBeLessThan(
      sidebarSource.indexOf('to: "/whatsapp/automation"'),
    );
  });

  it("applies CSRF before error handling for server functions", () => {
    expect(startSource).toContain("createCsrfMiddleware");
    expect(startSource).toContain('filter: (ctx) => ctx.handlerType === "serverFn"');
    expect(startSource).toContain("requestMiddleware: [csrfMiddleware, errorMiddleware]");
    expect(startSource).toContain("defaultSsr: false");
  });

  it("restores the dashboard loader and AI daily digest", () => {
    expect(dashboardSource).toContain("loader: () => loadDashboardData()");
    expect(dashboardSource).toContain("buildDailyDigest");
    expect(dashboardSource).toContain("AI daily digest");
    expect(dashboardSource).toContain("annualReturnDataAvailable");
  });

  it("restores editable settings while retaining the knowledge base", () => {
    expect(settingsSource).toContain("templatesStore.update");
    expect(settingsSource).toContain("templatesStore.addDocument");
    expect(settingsSource).toContain("Service packages");
    expect(settingsSource).toContain("WOZTELL WhatsApp API");
    expect(settingsSource).toContain("<KnowledgeBaseSection />");
  });

  it("restores team, member, and role views", () => {
    expect(teamsSource).toContain("teams.map");
    expect(teamsSource).toContain("teamMembers.map");
    expect(teamsSource).toContain("Roles & permissions");
    expect(teamsSource).not.toContain("ready for the next workflow phase");
  });

  it("uses an explicit not-found route outcome for unknown clients", () => {
    expect(clientDetailSource).toContain("notFound");
    expect(clientDetailSource).not.toContain("?? clients[0]");
    expect(clientDetailSource).not.toContain("if (!client) return null");
  });

  it("keeps the client routes on the shared client store with full profile sections", () => {
    expect(clientsSource).toContain("useAllCompanies");
    expect(clientsSource).toContain("Search clients");
    expect(clientDetailSource).toContain("useCompanyById");
    expect(clientDetailSource).toContain("Annual return history");
    expect(clientDetailSource).toContain('title="Company timeline"');
  });

  it("keeps local knowledge ingestion, import, editing, and indexed previews wired", () => {
    expect(knowledgeBaseSectionSource).toContain("kbStore.uploadDoc(file)");
    expect(knowledgeBaseSectionSource).toContain("onDrop=");
    expect(knowledgeBaseSectionSource).toContain('type="file"');
    expect(knowledgeBaseSectionSource).toContain("parseFaqImport");
    expect(knowledgeBaseSectionSource).toContain("kbStore.importFaqs");
    expect(knowledgeBaseSectionSource).toContain("Indexed content preview");
  });

  it("keeps the enquiry inbox as a conversation workflow instead of a redirect", () => {
    expect(enquiriesSource).toContain("active.messages.map");
    expect(enquiriesSource).toContain("triageEnquiry");
    expect(enquiriesSource).toContain("ConvertToClientDialog");
    expect(enquiriesSource).toContain("AiAssistantPanel");
    expect(enquiriesSource).toContain("Send quote");
    expect(enquiriesSource).not.toContain('to="/whatsapp"');
  });
});
