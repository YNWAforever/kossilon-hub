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
    defaultPreloadStaleTime: 0,
  });

  return router;
};
