import { createFileRoute } from "@tanstack/react-router";

import { RequestAccessPage } from "@/features/auth/request-access-page";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/en_/request-access")({
  ssr: true,
  head: () => ({
    meta: [
      { title: pageTitle("Request access") },
      { name: "description", content: "Request ComSec OS workspace access." },
    ],
  }),
  component: () => <RequestAccessPage locale="en" />,
});
