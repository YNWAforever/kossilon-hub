// Turns a kebab-case database value into a display label: "payment-pending"
// becomes "待付款". Known values use the Traditional Chinese (Hong Kong) label from
// docs/ui-language.md; anything else is title-cased so an unexpected value is
// still shown rather than hidden.
//
// Takes null and undefined even though the callers' types say it cannot. Those
// types are compile-time claims about a database this code does not own. A NULL
// column, or a field JSON.stringify drops in transit because it was undefined,
// both arrive here — and inside .split() either one threw, which turned a
// single missing label into a white screen for the whole route.
//
// The placeholder is deliberately visible. An em dash in the column tells a
// reader that one record is short a value; the crash told them nothing at all.
const LABELS: Record<string, string> = {
  // Case and filing status
  preparing: "準備中",
  "waiting-documents": "等待文件",
  "payment-pending": "待付款",
  "internal-review": "內部覆核",
  "ready-to-file": "可遞交",
  filed: "已遞交",
  overdue: "已逾期",
  "due-soon": "即將到期",
  blocked: "受阻",
  healthy: "正常",
  open: "待處理",
  "in-progress": "處理中",
  in_progress: "處理中",
  complete: "已完成",
  completed: "已完成",
  cancelled: "已取消",
  draft: "草稿",
  sent: "已發送",
  // Packet and review
  "not-started": "未開始",
  "in-review": "覆核中",
  "ready-for-review": "待覆核",
  approved: "已批准",
  accepted: "已接納",
  rejected: "已退回",
  superseded: "已被取代",
  "pending-review": "待覆核",
  generated: "已產生",
  submitted: "已提交",
  // Documents
  required: "需提交",
  uploaded: "已上載",
  "not-uploaded": "未上載",
  received: "已收到",
  missing: "缺少",
  requested: "已要求",
  verified: "已核對",
  quarantined: "隔離中",
  unscanned: "未掃描",
  clean: "安全",
  unsafe: "不安全",
  identity: "身分證明",
  registry: "登記冊",
  signature: "簽署",
  payment: "付款",
  packet: "交件套件",
  submission: "遞交記錄",
  receipt: "回條",
  other: "其他",
  "client-portal": "客戶入口",
  "staff-packet": "同事交件套件",
  "filing-submission": "遞交記錄",
  "filing-receipt": "遞交回條",
  // Payment
  paid: "已付款",
  pending: "待付款",
  partial: "部分付款",
  // Work and delivery
  none: "正常",
  warning: "有風險",
  breach: "已逾時",
  breached: "已逾時",
  acknowledged: "已確認知悉",
  active: "有效",
  inactive: "已停用",
  queued: "排隊中",
  processing: "處理中",
  running: "執行中",
  succeeded: "成功",
  failed: "失敗",
  delivered: "已送達",
  read: "已讀",
  simulated: "模擬",
  unknown: "未知",
  high: "高",
  normal: "一般",
};

export function labelValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  return (
    LABELS[value] ??
    value
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}
