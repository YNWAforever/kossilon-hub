import { DemoUnavailable } from "@/components/demo-unavailable";
import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "list" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  list: {
    title: "公司變更",
    message: "公司變更申請追蹤實時案件資料，並無示範資料。請登入正式環境使用。",
  },
  detail: {
    title: "公司變更申請",
    message: "公司變更申請詳情讀取實時案件資料，並無示範資料。請登入正式環境查看。",
  },
};

export function DemoCorporateChangeNotice({ variant }: Props) {
  const copy = COPY[variant];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="案件與客戶" title={copy.title} />
      <DemoUnavailable message={copy.message} />
    </main>
  );
}
