import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/features/marketing/page";
import { marketingHead } from "@/features/marketing/seo";

export const Route = createFileRoute("/en")({
  ssr: true,
  head: () => marketingHead("en"),
  component: () => <MarketingPage locale="en" />,
});
