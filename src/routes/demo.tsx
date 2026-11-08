import { createFileRoute, redirect } from "@tanstack/react-router";

import { DemoEntryPage } from "@/features/auth/demo-entry-page";
import { isDemoAuthEnabled } from "@/features/auth/route-guard";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/demo")({
  ssr: true,
  // A fixture demo build already lists its demo identities on /login; send the
  // visitor there instead of duplicating the picker on a second URL.
  beforeLoad: () => {
    if (isDemoAuthEnabled()) throw redirect({ href: "/login", replace: true });
  },
  head: () => ({
    meta: [
      { title: pageTitle("示範") },
      { name: "description", content: "ComSec OS 示範工作空間說明。" },
    ],
  }),
  component: DemoEntryPage,
});
