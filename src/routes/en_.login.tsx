import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";
import { LoginPage } from "@/features/auth/login-page";

export const Route = createFileRoute("/en_/login")({
  ssr: true,
  head: () => ({
    meta: [
      { title: pageTitle("Sign in") },
      { name: "description", content: "Sign in to your ComSec OS workspace." },
    ],
  }),
  component: () => <LoginPage locale="en" />,
});
