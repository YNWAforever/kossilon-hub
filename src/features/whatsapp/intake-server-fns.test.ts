import { describe, expect, it } from "vitest";
import {
  messageMappingSchema,
  mediaIntakeSchema,
  withWhatsAppIntakeConflict,
} from "./intake-server-fns";
import { withFollowUpVersionConflict } from "@/features/annual-return/follow-up-server-fns";
import { ReadinessConflictError } from "@/features/annual-return/readiness";
const id = "11111111-1111-4111-8111-111111111111";
describe("observed WhatsApp approval RPC contracts", () => {
  it("rejects caller identity, arbitrary media URL and absent observed mapping", () => {
    const mapping = {
      messageId: id,
      caseId: id,
      expectedVersion: 0,
      reason: "Confirmed case evidence",
    };
    expect(messageMappingSchema.parse(mapping)).toEqual(mapping);
    expect(() => messageMappingSchema.parse({ ...mapping, actorId: id })).toThrow();
    expect(() => mediaIntakeSchema.parse({ mediaId: id, category: "other" })).toThrow();
    expect(() =>
      mediaIntakeSchema.parse({
        mediaId: id,
        category: "other",
        expectedMappingVersion: 1,
        url: "https://private.example",
      }),
    ).toThrow();
  });
  it("returns HTTP409 for stale mapping and follow-up approval", async () => {
    for (const call of [
      () =>
        withWhatsAppIntakeConflict(async () => {
          throw Object.assign(new Error("Owned stale mapping"), { statusCode: 409 });
        }),
      () =>
        withFollowUpVersionConflict(async () => {
          throw new ReadinessConflictError();
        }),
    ]) {
      const result = await call().catch((error: unknown) => error);
      expect(result).toBeInstanceOf(Response);
      if (!(result instanceof Response)) throw new Error("Expected a conflict response.");
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({ code: "version_conflict" });
    }
  });
});
