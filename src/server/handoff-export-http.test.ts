import { describe, expect, it, vi } from "vitest";
import { createHandoffExportHttpHandler } from "./handoff-export-http";
const id = "22222222-2222-4222-8222-222222222222",
  input = { handoffId: id, expectedVersion: "v1" };
const request = (body: unknown = input, origin = "https://test.invalid") =>
  new Request("https://test.invalid/api/handoffs/export", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("approved ZIP stream HTTP boundary", () => {
  it("streams over 4.5MB in bounded binary chunks with no-store rather than a JSON/base64 RPC", async () => {
    const zip = new Uint8Array(5 * 1024 * 1024).fill(0x50),
      exporter = vi.fn().mockResolvedValue({ fileName: `approved-package-${id}.zip`, zip });
    const response = await createHandoffExportHttpHandler(exporter)(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain(id);
    expect(response.headers.has("content-length")).toBe(false);
    const reader = response.body!.getReader();
    let total = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      expect(chunk.value.length).toBeLessThanOrEqual(65536);
      total += chunk.value.length;
    }
    expect(total).toBe(zip.length);
    expect(exporter).toHaveBeenCalledWith(expect.any(Request), input);
  });
  it("refuses cross-origin, oversized/malformed/caller-authority data and GET before invoking storage or DB", async () => {
    const exporter = vi.fn(),
      handler = createHandoffExportHttpHandler(exporter);
    expect((await handler(request(input, "https://attacker.invalid"))).status).toBe(403);
    expect((await handler(request({ ...input, approvedBy: id }))).status).toBe(400);
    expect((await handler(request({ ...input, expectedVersion: "x".repeat(3000) }))).status).toBe(
      400,
    );
    expect((await handler(new Request("https://test.invalid/api/handoffs/export"))).status).toBe(
      405,
    );
    expect(exporter).not.toHaveBeenCalled();
  });
  it("returns a conflict without leaking provider or database error strings", async () => {
    const handler = createHandoffExportHttpHandler(async () => {
      throw Object.assign(new Error("secret database details"), { statusCode: 409 });
    });
    const response = await handler(request());
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("secret");
  });
});
