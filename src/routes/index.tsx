import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/features/marketing/page";
import { marketingHead } from "@/features/marketing/seo";

export const Route = createFileRoute("/")({
  ssr: true,
  head: () => marketingHead("zh-HK"),
  component: () => <MarketingPage locale="zh-HK" />,
});
