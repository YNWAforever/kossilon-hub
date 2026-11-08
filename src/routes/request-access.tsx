import { createFileRoute } from "@tanstack/react-router";

import { RequestAccessPage } from "@/features/auth/request-access-page";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/request-access")({
  ssr: true,
  head: () => ({
    meta: [
      { title: pageTitle("申請開通") },
      { name: "description", content: "申請 ComSec OS 工作空間開通。" },
    ],
  }),
  component: () => <RequestAccessPage locale="zh-HK" />,
});
