import { z } from "zod";
import { checklistSearchAliases } from "@/lib/checklist-item-label";
import { annualReturnStatusLabels } from "@/features/annual-return/labels";

const aliases: [string, string][] = (
  [
    ["建立周年申報案件", "Set up new annual return case"],
    ["覆核周年申報狀態", "Review annual return status"],
    ["覆核文件", "Review document"],
    ["覆核付款", "Review payment"],
    ["覆核遞交證明", "Review filing proof"],
    ["處理名稱變更申請", "Process name change request"],
    ["處理股份轉讓申請", "Process share transfer request"],
    ["處理高級人員變更申請", "Process officer change request"],
    ["處理地址變更申請", "Process address change request"],
    ["周年申報案件", "annual_return_case"],
    ["公司變更申請", "corporate_change_request"],
    ...checklistSearchAliases(),
    ...Object.entries(annualReturnStatusLabels).map(([raw, label]): [string, string] => [
      label,
      raw,
    ]),
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

/** Both list reads and snapshots search original values with this vocabulary. */
export function workItemSearchNeedles(q: string | undefined): string[] {
  const original = q?.trim().replace(/\s+/g, " ") ?? "";
  if (!original) return [];
  let translated = original;
  for (const [label, stored] of aliases) translated = translated.replaceAll(label, stored);
  translated = translated.replaceAll("：", ": ").replace(/\s+/g, " ").trim();
  return [...new Set([original, translated])];
}
export function workItemSearchPatterns(q: string | undefined): string[] {
  return workItemSearchNeedles(q).map(
    (needle) => `%${needle.replace(/[\\%_]/g, (v) => `\\${v}`)}%`,
  );
}
export function matchesWorkItemSearch(
  item: { title: string; workType: string; companyName: string | null },
  q: string,
) {
  const text = `${item.title} ${item.workType} ${item.companyName ?? ""}`.toLowerCase();
  return (
    workItemSearchNeedles(q).some((needle) => text.includes(needle.toLowerCase())) || !q.trim()
  );
}

export const queuePageCursorSchema = z
  .object({
    scope: z.string().max(4096),
    rank: z.number().int().min(0).max(1),
    due: z.string().max(128),
    priority: z.number().int(),
    id: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();
export type QueuePageCursor = z.infer<typeof queuePageCursorSchema>;
export function readQueuePageCursor(
  value: string | undefined,
  scope: string,
): QueuePageCursor | null {
  if (!value) return null;
  try {
    const cursor = queuePageCursorSchema.parse(JSON.parse(value));
    if (cursor.scope !== scope || !Number.isFinite(Date.parse(cursor.due))) throw new Error();
    return cursor;
  } catch {
    throw new Error("Invalid or changed queue cursor; refresh this list.");
  }
}
