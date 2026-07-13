import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { currentDataMode } from "./features/runtime/data-mode";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();
  const dataMode = currentDataMode();

  const router = createRouter({
    routeTree,
    context: { queryClient, dataMode },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
