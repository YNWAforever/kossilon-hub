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
