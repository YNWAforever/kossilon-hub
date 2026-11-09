import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { currentDataMode } from "./features/runtime/data-mode";
import { configureCspSafeZod } from "./lib/csp-safe-zod";
import { routeTree } from "./routeTree.gen";

// Zod's JIT probe is reported as a CSP `eval` violation in browsers; the rest of
// the app keeps zod's default (JIT) behaviour on the server.
configureCspSafeZod(typeof window !== "undefined");

export const getRouter = () => {
  const queryClient = new QueryClient();
  const dataMode = currentDataMode();

  const router = createRouter({
    routeTree,
    // `actor` is replaced by __root.beforeLoad on every navigation; this is the
    // pre-resolution value.
    context: { queryClient, dataMode, actor: null },
    scrollRestoration: true,
    getScrollRestorationKey: (location) => location.pathname + location.searchStr,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
