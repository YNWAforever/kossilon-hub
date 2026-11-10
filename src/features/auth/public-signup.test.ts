import { describe, expect, it } from "vitest";
import { isPublicSignupPath, publicSignupDisabledResponse } from "./public-signup";

describe("invite-only signup guard", () => {
  it("blocks every public sign-up variant", () => {
    for (const path of [
      "/api/auth/sign-up",
      "/api/auth/sign-up/",
      "/api/auth/sign-up/email",
      "/api/auth/sign-up/social",
    ]) {
      expect(isPublicSignupPath(path), path).toBe(true);
    }
  });

  it("does not touch sign-in, magic link, reset or admin paths", () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/auth/sign-in/magic-link",
      "/api/auth/sign-in/social",
      "/api/auth/forget-password",
      "/api/auth/admin/create-user",
      "/api/auth/get-session",
      "/api/capabilities",
    ]) {
      expect(isPublicSignupPath(path), path).toBe(false);
    }
  });

  it("returns a non-cacheable 403 with an actionable code", async () => {
    const response = publicSignupDisabledResponse();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "SIGNUP_DISABLED" });
  });
});
