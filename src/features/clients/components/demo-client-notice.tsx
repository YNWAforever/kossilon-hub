import { DemoUnavailable } from "@/components/demo-unavailable";
import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "register" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  register: {
    title: "客戶",
    message: "客戶名冊讀取實時公司紀錄，並無示範資料。請登入正式環境使用。",
  },
  detail: {
    title: "客戶資料",
    message: "客戶資料讀取實時公司紀錄，並無示範資料。請登入正式環境查看。",
  },
};

export function DemoClientNotice({ variant }: Props) {
  const copy = COPY[variant];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="案件與客戶" title={copy.title} />
      <DemoUnavailable message={copy.message} />
    </main>
  );
}
