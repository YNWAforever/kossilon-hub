import { daysBetween } from "@/lib/date-math";
import { SERVICE_TYPE_LABELS } from "./constants";
import type { ServiceSubscription } from "./types";

export function buildServiceSubscriptionReminderDraft(
  subscription: ServiceSubscription,
  companyName: string,
  contactName: string,
  today: string,
): string {
  const daysRemaining = daysBetween(today, subscription.renewalDate);
  const daysRemainingText =
    daysRemaining >= 0 ? `距離現時尚餘 ${daysRemaining} 天` : `已逾期 ${-daysRemaining} 天`;
  const serviceLabel = SERVICE_TYPE_LABELS[subscription.serviceType];

  return [
    `${contactName} 您好，我是高仕輪企業服務。`,
    `提提您，${companyName} 的${serviceLabel}服務將於 ${subscription.renewalDate} 到期，${daysRemainingText}，續期費用為 HK$${subscription.fee.toLocaleString()}。`,
    "如需續期，請回覆此訊息或聯絡我們安排付款，我們將為貴公司繼續提供服務。",
    "如有任何疑問，歡迎隨時聯絡我們。",
    "高仕輪企業服務",
  ].join("\n\n");
}
