import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "./types";

const attemptSchema = z
  .object({
    uploadRequestId: z.string().uuid(),
    fileName: z.string().min(1).max(255),
    contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    category: z.enum(DOCUMENT_CATEGORIES),
    checklistItemId: z.string().uuid().optional(),
    phase: z.enum(["prepared", "confirming", "sending", "uncertain", "received", "expired"]),
  })
  .strict();
export type UploadAttempt = z.infer<typeof attemptSchema>;

/** Metadata only: never persist file bytes, credentials or a client-supplied actor. */
export function createUploadJournal(
  scope: { actorScope: string; companyId: string; caseId: string },
  storage: () => Pick<Storage, "getItem" | "setItem"> = () => sessionStorage,
) {
  const key = `kossilon:upload-resume:v1:${JSON.stringify(scope)}`;
  const read = (): UploadAttempt[] => {
    try {
      const value = storage().getItem(key);
      return value === null ? [] : z.array(attemptSchema).max(64).parse(JSON.parse(value));
    } catch {
      throw new Error("無法讀取上載恢復紀錄；請保留畫面並聯絡負責同事，避免重複上載。");
    }
  };
  return {
    read,
    save(attempt: UploadAttempt) {
      const parsed = attemptSchema.parse(attempt),
        rows = read();
      const index = rows.findIndex((row) => row.uploadRequestId === parsed.uploadRequestId);
      if (index < 0) rows.push(parsed);
      else rows[index] = parsed;
      if (rows.length > 64) throw new Error("上載恢復紀錄已滿，請聯絡負責同事核對未完成的上載。");
      try {
        storage().setItem(key, JSON.stringify(rows));
      } catch {
        throw new Error("無法保存上載恢復紀錄；尚未確認的上載請保留原檔後再試。");
      }
    },
  };
}

export function matchesUploadFile(
  attempt: UploadAttempt,
  file: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
  },
) {
  return (
    attempt.fileName === file.fileName &&
    attempt.contentType === file.contentType &&
    attempt.sizeBytes === file.sizeBytes &&
    attempt.checksum === file.checksum
  );
}
