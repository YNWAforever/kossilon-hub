import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  annualReturnReminderCommandStorageKey,
  annualReturnReminderLatestStorageKey,
  classifyManualReminderCommand,
  persistAnnualReturnReminderCommand,
  persistLatestAnnualReturnReminderCommand,
  readLatestAnnualReturnReminderCommand,
  readStoredAnnualReturnReminderCommand,
  type ManualReminderOutboxRow,
} from "./reminder-command";
import { readAnnualReturnReminderCommandSchema } from "./server-fns";

const caseId = "40000000-0000-4000-8000-000000000001";
const commandUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function row(overrides: Partial<ManualReminderOutboxRow> = {}): ManualReminderOutboxRow {
  return {
    status: "pending",
    payload: { whatsappMessageId: "msg-1", toPhone: "+85291234567", body: "secret deadline" },
    lastErrorCode: null,
    dispatchStartedAttempt: null,
    redactedAt: null,
    ...overrides,
  };
}

describe("classifyManualReminderCommand", () => {
  it("returns only a closed state and the message id", () => {
    expect(classifyManualReminderCommand(null)).toEqual({ state: "absent" });
    const queued = classifyManualReminderCommand(row());
    expect(queued).toEqual({ state: "queued", messageId: "msg-1" });
    expect(JSON.stringify(queued)).not.toContain("852");
    expect(JSON.stringify(queued)).not.toContain("secret");
    expect(classifyManualReminderCommand(row({ status: "processing" }))).toEqual({
      state: "queued",
      messageId: "msg-1",
    });
    expect(classifyManualReminderCommand(row({ status: "sent" }))).toEqual({
      state: "sent",
      messageId: "msg-1",
    });
    expect(classifyManualReminderCommand(row({ status: "failed" }))).toEqual({
      state: "failed",
      messageId: "msg-1",
    });
    expect(classifyManualReminderCommand(row({ status: "cancelled" }))).toEqual({
      state: "failed",
      messageId: "msg-1",
    });
  });

  it("treats a dispatch marker or unknown outcome as unknown, ahead of status", () => {
    expect(
      classifyManualReminderCommand(row({ status: "processing", dispatchStartedAttempt: 1 })),
    ).toEqual({ state: "unknown", messageId: "msg-1" });
    expect(
      classifyManualReminderCommand(
        row({ status: "failed", lastErrorCode: "dispatch_outcome_unknown" }),
      ),
    ).toEqual({ state: "unknown", messageId: "msg-1" });
    expect(classifyManualReminderCommand(row({ status: "something-else" }))).toEqual({
      state: "unknown",
      messageId: "msg-1",
    });
  });

  it("treats a null payload as redacted and omits the message id", () => {
    expect(
      classifyManualReminderCommand(
        row({
          status: "sent",
          payload: null,
          lastErrorCode: null,
          dispatchStartedAttempt: 1,
          redactedAt: "2026-10-27T00:00:00.000Z",
        }),
      ),
    ).toEqual({ state: "redacted" });
  });

  it("reads the outbox by the command key and does not select a recipient", () => {
    const source = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
    const start = source.indexOf("async function readManualReminderOutbox");
    const end = source.indexOf("return {", start);
    const body = source.slice(start, end);
    expect(body).toContain("annualReturnManualReminderIdempotencyKey(");
    expect(body).not.toContain("recipient");
    expect(body).not.toContain("insert ");
    expect(
      readAnnualReturnReminderCommandSchema.safeParse({
        caseId,
        commandUuid,
        recipientPhone: "+85291234567",
      }).success,
    ).toBe(false);
  });
});

describe("annual return reminder command journal", () => {
  function memory() {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
    };
  }

  it("keeps phone spelling in the snapshot and out of a shared command id", () => {
    const spaced = annualReturnReminderCommandStorageKey({
      actorScope: "actor-a",
      caseId,
      recipientName: "Ada Chan",
      recipientPhone: "+852 6123 4567",
    });
    const compact = annualReturnReminderCommandStorageKey({
      actorScope: "actor-a",
      caseId,
      recipientName: "Ada Chan",
      recipientPhone: "+85261234567",
    });
    expect(spaced).not.toBe(compact);
    expect(
      annualReturnReminderCommandStorageKey({
        actorScope: "actor-b",
        caseId,
        recipientName: "Ada Chan",
        recipientPhone: "+852 6123 4567",
      }),
    ).not.toBe(spaced);

    const storage = memory();
    persistAnnualReturnReminderCommand(storage, spaced, commandUuid);
    expect(readStoredAnnualReturnReminderCommand(storage, spaced)).toBe(commandUuid);
    expect(readStoredAnnualReturnReminderCommand(storage, compact)).toBeNull();
  });

  it("refuses a corrupt journal instead of minting over it", () => {
    const storage = memory();
    const key = annualReturnReminderCommandStorageKey({
      actorScope: "actor-a",
      caseId,
      recipientName: "Ada",
      recipientPhone: "+85291234567",
    });
    storage.setItem(key, "{");
    expect(() => readStoredAnnualReturnReminderCommand(storage, key)).toThrow(/提醒指令紀錄/);
    expect(readStoredAnnualReturnReminderCommand(storage, `${key}:missing`)).toBeNull();
  });

  it("remembers the latest command for this actor and case", () => {
    const storage = memory();
    const latestKey = annualReturnReminderLatestStorageKey({ actorScope: "actor-a", caseId });
    persistLatestAnnualReturnReminderCommand(storage, latestKey, {
      recipientName: "Ada Chan",
      recipientPhone: "+852 6123 4567",
      commandUuid,
    });
    expect(readLatestAnnualReturnReminderCommand(storage, latestKey)).toEqual({
      recipientName: "Ada Chan",
      recipientPhone: "+852 6123 4567",
      commandUuid,
    });
  });
});
