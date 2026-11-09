import { createFileRoute } from "@tanstack/react-router";

import { RequestAccessPage } from "@/features/auth/request-access-page";
import { getRequestAccessAvailability } from "@/features/onboarding/server-fns";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/request-access")({
  ssr: true,
  loader: async () => getRequestAccessAvailability(),
  head: () => ({
    meta: [
      { title: pageTitle("申請開通") },
      { name: "description", content: "申請 ComSec OS 工作空間開通。" },
    ],
  }),
  component: RequestAccessRoute,
});

function RequestAccessRoute() {
  const { available } = Route.useLoaderData();
  return <RequestAccessPage locale="zh-HK" formAvailable={available} />;
}
