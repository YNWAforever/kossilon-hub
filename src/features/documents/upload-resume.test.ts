import { describe, expect, it } from "vitest";
import { createUploadJournal, matchesUploadFile, type UploadAttempt } from "./upload-resume";
const scope = { actorScope: "client-A", companyId: "company-A", caseId: "case-A" };
const attempt: UploadAttempt = {
  uploadRequestId: "98d2f4c9-0150-4150-8150-000000000001",
  fileName: "QA.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  checksum: "a".repeat(64),
  category: "signature",
  checklistItemId: "98d2f4c9-0150-4150-8150-000000000007",
  phase: "uncertain",
};
function fixture() {
  const values = new Map<string, string>();
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  return { values, storage, journal: createUploadJournal(scope, storage) };
}
describe("UC150 metadata-only upload journal", () => {
  it("persists a logical attempt through reopen, updating its phase without duplication", () => {
    const f = fixture();
    f.journal.save(attempt);
    f.journal.save({ ...attempt, phase: "received" });
    expect(createUploadJournal(scope, f.storage).read()).toEqual([
      { ...attempt, phase: "received" },
    ]);
    expect([...f.values.values()][0]).not.toMatch(/bodyBase64|access_token|fileBytes/);
  });
  it.each([{ actorScope: "client-B" }, { companyId: "company-B" }, { caseId: "case-B" }])(
    "isolates the journal scope for %j",
    (change) => {
      const f = fixture();
      f.journal.save(attempt);
      expect(createUploadJournal({ ...scope, ...change }, f.storage).read()).toEqual([]);
    },
  );
  it("refuses corrupt or unexpected persisted fields instead of losing a request identity", () => {
    const f = fixture();
    f.journal.save(attempt);
    const key = [...f.values.keys()][0];
    f.values.set(key, "{");
    expect(() => f.journal.read()).toThrow(/無法讀取/);
    f.values.set(key, JSON.stringify([{ ...attempt, fileBytes: "do-not-store" }]));
    expect(() => f.journal.read()).toThrow(/無法讀取/);
  });
  it("caps records without silently evicting uncertain attempts", () => {
    const f = fixture();
    for (let i = 0; i < 64; i++)
      f.journal.save({
        ...attempt,
        uploadRequestId: `98d2f4c9-0150-4150-8150-${String(i).padStart(12, "0")}`,
      });
    expect(() =>
      f.journal.save({ ...attempt, uploadRequestId: "98d2f4c9-0150-4150-8150-000000000999" }),
    ).toThrow(/已滿/);
    expect(f.journal.read()).toHaveLength(64);
  });
  it("requires the same bytes, file metadata and size for re-selection", () => {
    expect(matchesUploadFile(attempt, attempt)).toBe(true);
    for (const change of [
      { checksum: "b".repeat(64) },
      { fileName: "different.pdf" },
      { contentType: "image/png" },
      { sizeBytes: 1025 },
    ])
      expect(matchesUploadFile(attempt, { ...attempt, ...change })).toBe(false);
  });
});
