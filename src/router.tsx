// Must be first: disables zod's browser JIT probe before any schema module
// initializes (the probe is reported as a CSP `eval` violation).
import "./lib/csp-safe-zod-client";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { currentDataMode } from "./features/runtime/data-mode";
import { routeTree } from "./routeTree.gen";

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
