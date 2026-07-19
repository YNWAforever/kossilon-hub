import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";

export function createNeonAuthClient(url: string, appOrigin = window.location.origin) {
  const normalizedUrl = new URL(url);
  const normalizedOrigin = new URL(appOrigin);

  if (normalizedUrl.protocol !== "https:") {
    throw new Error("Neon Auth URL must use HTTPS.");
  }
  if (normalizedOrigin.protocol !== "https:") {
    throw new Error("Application origin must use HTTPS.");
  }

  return createAuthClient({
    baseURL: `${normalizedOrigin.toString().replace(/\/$/, "")}/api/auth`,
    plugins: [magicLinkClient()],
  });
}

export type NeonAuthClient = ReturnType<typeof createNeonAuthClient>;
