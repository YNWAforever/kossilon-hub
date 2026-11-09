import { createFileRoute } from "@tanstack/react-router";

import { RequestAccessPage } from "@/features/auth/request-access-page";
import { getRequestAccessAvailability } from "@/features/onboarding/server-fns";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/en_/request-access")({
  ssr: true,
  loader: async () => getRequestAccessAvailability(),
  head: () => ({
    meta: [
      { title: pageTitle("Request access") },
      { name: "description", content: "Request ComSec OS workspace access." },
    ],
  }),
  component: RequestAccessRoute,
});

function RequestAccessRoute() {
  const { available } = Route.useLoaderData();
  return <RequestAccessPage locale="en" formAvailable={available} />;
}
