const statusLabels: Record<string, string> = {
  Intake: "待整理資料",
  Requested: "待處理",
  "Documents pending": "待追文件",
  "Ready to file": "待準備交件",
  "Filed with Registrar": "已提交",
  Completed: "已完成",
  Cancelled: "已取消",
};
export const businessStatusLabel = (status: string) => statusLabels[status] ?? "待核對";
export const corporateChangeLabel = (kind: string) =>
  ({
    name_change: "公司名稱變更",
    share_transfer: "股份轉讓",
    officer_change: "董事／秘書變更",
    address_change: "註冊地址變更",
  })[kind] ?? "公司變更";
export function staffSettingsError(error: unknown) {
  const e = error as { statusCode?: number; status?: number; message?: string } | null;
  return e?.statusCode === 409 ||
    e?.status === 409 ||
    /^409[: ]|^Template revision changed/i.test(e?.message ?? "")
    ? "範本版本已變更；你的輸入仍保留。請比較最新版，再明確重套或放棄輸入。支援編號：R22-SETTINGS-CONFLICT。"
    : "儲存結果未確認；你的輸入仍保留。請先核對服務及已保存版本，再決定重試。支援編號：R22-SETTINGS-SAVE。";
}
