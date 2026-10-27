import { z } from "zod";

export type ManualReminderOutboxRow = {
  status: string;
  payload: unknown;
  lastErrorCode: string | null;
  dispatchStartedAttempt: number | null;
  redactedAt: string | null;
};

export type ManualReminderCommandReceipt =
  | { state: "absent" }
  | { state: "redacted" }
  | {
      state: "queued" | "sent" | "failed" | "unknown";
      messageId: string | null;
    };

/**
 * Closed states for one manual reminder command.
 *
 * `absent` is the only state that means this command did not commit. Every
 * other state means do not POST that command again. Redaction wins over a
 * dispatch marker: a null payload is the outbox retention rule, and it no
 * longer carries a message id.
 */
export function classifyManualReminderCommand(
  row: ManualReminderOutboxRow | null,
): ManualReminderCommandReceipt {
  if (!row) return { state: "absent" };
  if (row.payload === null || row.redactedAt !== null) return { state: "redacted" };

  const messageId = messageIdFromPayload(row.payload);
  if (row.lastErrorCode === "dispatch_outcome_unknown" || row.dispatchStartedAttempt !== null) {
    return { state: "unknown", messageId };
  }
  if (row.status === "pending" || row.status === "processing") {
    return { state: "queued", messageId };
  }
  if (row.status === "sent") return { state: "sent", messageId };
  if (row.status === "failed" || row.status === "cancelled") {
    return { state: "failed", messageId };
  }
  return { state: "unknown", messageId };
}

function messageIdFromPayload(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "whatsappMessageId" in payload &&
    typeof payload.whatsappMessageId === "string" &&
    payload.whatsappMessageId.length > 0
  ) {
    return payload.whatsappMessageId;
  }
  return null;
}

export function manualReminderReceiptCopy(receipt: ManualReminderCommandReceipt): string {
  switch (receipt.state) {
    case "absent":
      return "此指令沒有登記。可再按發送，沿用同一指令。";
    case "queued":
      return "此提醒已排入，尚未確認送達。請勿再送同一指令。";
    case "sent":
      return "此提醒已送出。再按發送會建立新的提醒。";
    case "failed":
      return "此提醒未能送出。再按發送會建立新的提醒。";
    case "unknown":
      return "此提醒的送達結果未明。再按發送會建立新的提醒，不會重放同一指令。";
    case "redacted":
      return "此提醒紀錄已封存，不能重放。再按發送會建立新的提醒。";
  }
}

const COMMAND_PREFIX = "kossilon:annual-return-reminder-command:v1:";
const LATEST_PREFIX = "kossilon:annual-return-reminder-command:latest:v1:";
const UNREADABLE = "無法讀取提醒指令紀錄；請保留畫面並聯絡負責同事，避免重複發送。";
const UNSAVED = "無法保存提醒指令紀錄；尚未發送，請保留原收件人後再試。";

const storedCommandSchema = z.object({ commandUuid: z.string().uuid() }).strict();
const latestCommandSchema = z
  .object({
    recipientName: z.string().trim().min(1),
    recipientPhone: z.string().trim().min(3),
    commandUuid: z.string().uuid(),
  })
  .strict();

export type AnnualReturnReminderCommandSnapshot = {
  actorScope: string;
  caseId: string;
  recipientName: string;
  recipientPhone: string;
};

export type StoredAnnualReturnReminderCommand = {
  recipientName: string;
  recipientPhone: string;
  commandUuid: string;
};

/** Actor, case, and the recipient text as typed. Phone spelling is not normalised. */
export function annualReturnReminderCommandStorageKey(
  input: AnnualReturnReminderCommandSnapshot,
): string {
  return (
    COMMAND_PREFIX +
    JSON.stringify({
      actorScope: input.actorScope,
      caseId: input.caseId,
      recipientName: input.recipientName.trim(),
      recipientPhone: input.recipientPhone.trim(),
    })
  );
}

export function annualReturnReminderLatestStorageKey(input: {
  actorScope: string;
  caseId: string;
}): string {
  return LATEST_PREFIX + JSON.stringify({ actorScope: input.actorScope, caseId: input.caseId });
}

export function readStoredAnnualReturnReminderCommand(
  storage: Pick<Storage, "getItem">,
  key: string,
): string | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(UNREADABLE);
  }
  const result = storedCommandSchema.safeParse(parsed);
  if (!result.success) throw new Error(UNREADABLE);
  return result.data.commandUuid;
}

export function persistAnnualReturnReminderCommand(
  storage: Pick<Storage, "setItem">,
  key: string,
  commandUuid: string,
): void {
  const id = z.string().uuid().parse(commandUuid);
  try {
    storage.setItem(key, JSON.stringify({ commandUuid: id }));
  } catch {
    throw new Error(UNSAVED);
  }
}

export function readLatestAnnualReturnReminderCommand(
  storage: Pick<Storage, "getItem">,
  key: string,
): StoredAnnualReturnReminderCommand | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(UNREADABLE);
  }
  const result = latestCommandSchema.safeParse(parsed);
  if (!result.success) throw new Error(UNREADABLE);
  return result.data;
}

export function persistLatestAnnualReturnReminderCommand(
  storage: Pick<Storage, "setItem">,
  key: string,
  command: StoredAnnualReturnReminderCommand,
): void {
  const parsed = latestCommandSchema.parse(command);
  try {
    storage.setItem(key, JSON.stringify(parsed));
  } catch {
    throw new Error(UNSAVED);
  }
}
