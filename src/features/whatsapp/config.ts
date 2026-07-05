import type { WhatsAppProviderConfig, WhatsAppWebhookConfig } from "./types";

type Env = Record<string, string | undefined>;

export const WHATSAPP_LIVE_PROVIDER_ENV_KEYS = [
  "WOZTELL_API_BASE_URL",
  "WOZTELL_ACCESS_TOKEN",
  "WOZTELL_CHANNEL_ID",
  "WOZTELL_WEBHOOK_SECRET",
] as const;

function readEnvValue(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function assertRequiredEnv(env: Env, keys: readonly string[]): Record<string, string> {
  const missing = missingWhatsAppEnvVars(env, keys);

  if (missing.length > 0) {
    throw new Error(`Missing WhatsApp integration env vars: ${missing.join(", ")}`);
  }

  return Object.fromEntries(keys.map((key) => [key, readEnvValue(env, key)!]));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getWhatsAppWebhookConfig(env: Env = process.env): WhatsAppWebhookConfig {
  const values = assertRequiredEnv(env, ["WOZTELL_WEBHOOK_SECRET"]);

  return {
    provider: "woztell",
    webhookSecret: values.WOZTELL_WEBHOOK_SECRET,
  };
}

export function getWhatsAppProviderConfig(env: Env = process.env): WhatsAppProviderConfig {
  const values = assertRequiredEnv(env, WHATSAPP_LIVE_PROVIDER_ENV_KEYS);

  return {
    provider: "woztell",
    apiBaseUrl: normalizeBaseUrl(values.WOZTELL_API_BASE_URL),
    accessToken: values.WOZTELL_ACCESS_TOKEN,
    channelId: values.WOZTELL_CHANNEL_ID,
    webhookSecret: values.WOZTELL_WEBHOOK_SECRET,
  };
}

export function missingWhatsAppEnvVars(env: Env, keys: readonly string[]): string[] {
  return keys.filter((key) => !readEnvValue(env, key));
}
