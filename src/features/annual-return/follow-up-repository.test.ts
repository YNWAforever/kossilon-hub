import { describe, expect, it } from "vitest";
import type { SqlClient } from "@/server/db/client";
import { createProductionFollowUpRepository } from "./follow-up-repository";

describe("production follow-up repository", () => {
  it("loads evidence only through authoritative checklist and payment references", async () => {
    const queries: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return Promise.resolve([]);
    }) as unknown as SqlClient;
    const repository = createProductionFollowUpRepository({ sql });

    await expect(
      repository.listPersistedState(["11111111-1111-4111-8111-111111111111"]),
    ).resolves.toEqual({ recipients: [], evidence: [], deliveries: [] });

    const evidenceQuery = queries.find((query) => query.includes("document_upload_intents"));
    expect(evidenceQuery).toMatch(
      /join annual_return_checklist_items checklist\s+on checklist\.document_id = d\.id/i,
    );
    expect(evidenceQuery).toMatch(
      /join payments payment\s+on payment\.payment_proof_document_id = d\.id/i,
    );
  });
});
