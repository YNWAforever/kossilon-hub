import { createFileRoute } from "@tanstack/react-router";

import { LoginPage } from "@/features/auth/login-page";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/login")({
  ssr: true,
  head: () => ({
    meta: [
      { title: pageTitle("登入") },
      {
        name: "description",
        content: `登入 ${PRODUCT_NAME}。`,
      },
    ],
  }),
  component: LoginPage,
});
