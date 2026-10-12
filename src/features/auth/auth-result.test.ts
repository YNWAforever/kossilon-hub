import { describe, expect, it } from "vitest";
import { classifyAuthError, authResolutionMessage } from "./auth-result";
describe("R24 reliable auth failure classification", () => {
  it.each([
    [{ status: 401 }, "unauthenticated"],
    [{ statusCode: 403 }, "forbidden"],
    [new Error("Unauthorized: no session"), "unauthenticated"],
    [new Error("Forbidden: inactive"), "forbidden"],
    [{ status: 503 }, "transient_error"],
    [new Error("network failure"), "transient_error"],
    [null, "transient_error"],
    [{ code: "INVALID_TOKEN" }, "callback_error"],
    [{ code: "unknown callback code" }, "transient_error"],
  ])("classifies %j as %s", (error, kind) => expect(classifyAuthError(error).kind).toBe(kind));
  it("does not include provider diagnostics or guess why a token is invalid", () => {
    const resolution = classifyAuthError(new Error("secret://private-provider-diagnostic"));
    expect(authResolutionMessage(resolution)).not.toContain("private-provider");
    expect(resolution).toMatchObject({
      kind: "transient_error",
      supportId: expect.stringMatching(/^auth-/),
    });
    expect(classifyAuthError({ code: "INVALID_TOKEN" })).toEqual({
      kind: "callback_error",
      reason: "invalid",
    });
  });
});
