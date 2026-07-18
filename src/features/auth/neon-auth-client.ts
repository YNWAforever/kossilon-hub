import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";

export function createNeonAuthClient(url: string) {
  const normalizedUrl = new URL(url);

  if (normalizedUrl.protocol !== "https:") {
    throw new Error("Neon Auth URL must use HTTPS.");
  }

  return createAuthClient({
    baseURL: normalizedUrl.toString().replace(/\/$/, ""),
    plugins: [magicLinkClient()],
  });
}

export type NeonAuthClient = ReturnType<typeof createNeonAuthClient>;
