import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const rootRouteSource = readFileSync(new URL("./__root.tsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(
  new URL("../components/app-sidebar.tsx", import.meta.url),
  "utf8",
);
// Destinations are defined once here and rendered by both the desktop sidebar and
// the mobile drawer, so the two can no longer expose different routes or labels.
const navigationSource = readFileSync(
  new URL("../components/navigation.ts", import.meta.url),
  "utf8",
);
const mobileNavSource = readFileSync(
  new URL("../components/app-mobile-nav.tsx", import.meta.url),
  "utf8",
);
const startSource = readFileSync(new URL("../start.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./settings.tsx", import.meta.url), "utf8");
const knowledgeBaseSectionSource = readFileSync(
  new URL("../components/knowledge-base-section.tsx", import.meta.url),
  "utf8",
);

describe("final review architecture restorations", () => {
  it("keeps the authenticated query-backed root shell and error boundaries wired", () => {
    expect(rootRouteSource).toContain("createRootRouteWithContext<RouterContext>()");
    expect(rootRouteSource).toContain("beforeLoad: async ({ context, location }) =>");
    expect(rootRouteSource).toContain("isPublicRoute(location.pathname)");
    expect(rootRouteSource).toContain("await getAuthenticatedActor()");
    expect(rootRouteSource).toContain("const { dataMode } = context;");
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
    expect(mobileNavSource).toContain('aria-label="Open navigation menu"');
    expect(mobileNavSource).toContain('<nav aria-label="Primary navigation"');
    expect(rootRouteSource).toContain("<AppMobileNav />");

    // Desktop and mobile render the same NavList, so the shared config is the
    // only place a destination or label can be defined.
    expect(sidebarSource).toContain("<NavList");
    expect(mobileNavSource).toContain("<NavList");

    for (const [path, label] of [
      ["/portal", "Portal"],
      ["/payments", "Payments"],
      ["/whatsapp/automation", "WhatsApp Automation"],
      ["/annual-returns", "Annual Returns"],
    ]) {
      expect(navigationSource).toContain(`to: "${path}", label: "${label}"`);
    }

    expect(navigationSource.indexOf('to: "/portal"')).toBeLessThan(
      navigationSource.indexOf('to: "/whatsapp/automation"'),
    );
  });

  it("applies CSRF before error handling for server functions", () => {
    expect(startSource).toContain("createCsrfMiddleware");
    expect(startSource).toContain('filter: (ctx) => ctx.handlerType === "serverFn"');
    expect(startSource).toContain("requestMiddleware: [csrfMiddleware, errorMiddleware]");
    expect(startSource).toContain("defaultSsr: false");
  });

  it("restores the dashboard loader and AI daily digest", () => {
    // The loader now picks its dependency set from route context rather than
    // always calling the production server functions. -dashboard-modes.test.tsx
    // renders both modes; this only pins that the branch is still there.
    expect(dashboardSource).toContain("loadDashboardData(");
    expect(dashboardSource).toContain('context.dataMode === "demo"');
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

  it("keeps local knowledge ingestion, import, editing, and indexed previews wired", () => {
    expect(knowledgeBaseSectionSource).toContain("kbStore.uploadDoc(file)");
    expect(knowledgeBaseSectionSource).toContain("onDrop=");
    expect(knowledgeBaseSectionSource).toContain('type="file"');
    expect(knowledgeBaseSectionSource).toContain("parseFaqImport");
    expect(knowledgeBaseSectionSource).toContain("kbStore.importFaqs");
    expect(knowledgeBaseSectionSource).toContain("Indexed content preview");
  });
});
