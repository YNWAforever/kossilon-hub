import { annualReturnStatusLabel } from "@/features/annual-return/labels";
import { CORPORATE_CHANGE_TYPE_LABELS } from "@/features/corporate-changes/labels";
import type { CorporateChangeType } from "@/features/corporate-changes/types";
import { checklistItemText } from "@/lib/checklist-item-label";

/**
 * Work item titles are written in English when the item is created (see the
 * annual-return and corporate-change repositories) and are stored data, so
 * they stay as written. The queue describes the known shapes in Chinese and
 * shows any other title exactly as stored.
 */
const TITLE_PATTERNS: [RegExp, (...match: string[]) => string][] = [
  [/^Set up new annual return case$/, () => "建立周年申報案件"],
  [
    /^Review annual return status: (.+)$/,
    (status) => `覆核周年申報狀態：${annualReturnStatusLabel(status)}`,
  ],
  [/^Review document: (.+)$/, (label) => `覆核文件：${checklistItemText(label)}`],
  [/^Review payment: (.+)$/, (invoice) => `覆核付款：${invoice}`],
  [/^Review filing proof: (.+)$/, (reference) => `覆核遞交證明：${reference}`],
  [
    /^Process (name change|share transfer|officer change|address change) request$/,
    (type) =>
      `處理${CORPORATE_CHANGE_TYPE_LABELS[type.replace(" ", "_") as CorporateChangeType]}申請`,
  ],
  // Written by the seed script for its reference rows.
  [/^Annual return (\d{4}) - (.+)$/, (year, company) => `${year} 年周年申報 - ${company}`],
];

export function describeWorkItemTitle(title: string): string {
  for (const [pattern, describe] of TITLE_PATTERNS) {
    const match = pattern.exec(title);
    if (match) return describe(...match.slice(1));
  }
  return title;
}
