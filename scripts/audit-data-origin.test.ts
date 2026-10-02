import { describe, expect, it, vi } from "vitest";
import { auditDataOrigin } from "./audit-data-origin";

describe("read-only data origin inventory", () => {
  it("retains a seed-looking client classification and reports bounded inventory without recipient content", async () => {
    const queries: string[] = [];
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      queries.push(text);
      if (text.includes("origin_counts"))
        return [{ origin_counts: [{ data_origin: "client", count: 1 }], total: 1 }];
      if (text.includes("from notification_outbox"))
        return [{ data_origin: "client", status: "pending", count: 1 }];
      return [{ id: "30000000-0000-0000-0000-000000000001", data_origin: "client", case_count: 1 }];
    });
    const result = await auditDataOrigin(query as unknown as Parameters<typeof auditDataOrigin>[0]);
    expect(result.companies[0].data_origin).toBe("client");
    expect(result.reclassificationPerformed).toBe(false);
    expect(result.truncated).toBe(false);
    expect(queries.every((text) => text.trim().startsWith("select"))).toBe(true);
    expect(queries.some((text) => /recipient|phone|email|payload|company_name/.test(text))).toBe(
      false,
    );
    expect(queries.some((text) => text.includes("c.updated_at"))).toBe(true);
  });
});
