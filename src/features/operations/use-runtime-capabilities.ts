import { useCallback, useEffect, useState } from "react";

import { currentDataMode, type DataMode } from "@/features/runtime/data-mode";

type Capabilities = Record<string, boolean>;

export type CapabilityRow = {
  id: string;
  configured: boolean;
  missing: readonly string[];
};

export type CapabilityAuthMethods = {
  password: boolean;
  magicLink: boolean;
  google: boolean;
};

export type CapabilitySecurity = {
  cspMode: "off" | "report-only" | "enforce";
  authMethods: CapabilityAuthMethods | null;
};

export const WHATSAPP_NAV_PATHS = ["/whatsapp", "/whatsapp/automation"] as const;

/**
 * Sidebar/drawer items that must not look available. In production, WhatsApp is
 * hidden until `/api/capabilities` says its WOZTELL bindings exist; in the
 * fixture demo the feature is intentionally visible (read-only fixtures).
 */
export function hiddenNavPaths(input: {
  dataMode: DataMode;
  configured: Capabilities;
}): ReadonlySet<string> {
  if (input.dataMode !== "production") return new Set();
  if (input.configured.whatsapp === true) return new Set();
  return new Set(WHATSAPP_NAV_PATHS);
}

/** The route-level gate: only hide once the capability report has loaded. */
export function isWhatsAppCapabilityUnavailable(input: {
  dataMode: DataMode;
  loaded: boolean;
  configured: Capabilities;
}): boolean {
  return input.dataMode === "production" && input.loaded && input.configured.whatsapp !== true;
}

let capabilityPromise: Promise<{
  configured: Capabilities;
  rows: CapabilityRow[];
  security: CapabilitySecurity | null;
}> | null = null;

async function loadCapabilities(): Promise<{
  configured: Capabilities;
  rows: CapabilityRow[];
  security: CapabilitySecurity | null;
}> {
  const response = await fetch("/api/capabilities", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`capabilities unavailable: ${response.status}`);
  const body = (await response.json()) as {
    capabilities?: { id?: string; configured?: boolean; missing?: unknown }[];
    security?: { cspMode?: unknown; authMethods?: unknown };
  };
  const rows = (body.capabilities ?? []).flatMap((capability) =>
    capability.id
      ? [
          {
            id: capability.id,
            configured: capability.configured === true,
            missing: Array.isArray(capability.missing)
              ? capability.missing.filter((item): item is string => typeof item === "string")
              : [],
          },
        ]
      : [],
  );
  const mode = body.security?.cspMode;
  const rawMethods = body.security?.authMethods;
  const authMethods: CapabilityAuthMethods | null =
    rawMethods && typeof rawMethods === "object"
      ? {
          password: (rawMethods as Record<string, unknown>).password === true,
          magicLink: (rawMethods as Record<string, unknown>).magicLink === true,
          google: (rawMethods as Record<string, unknown>).google === true,
        }
      : null;
  const security: CapabilitySecurity | null =
    mode === "enforce" || mode === "report-only" || mode === "off"
      ? { cspMode: mode, authMethods }
      : null;
  return {
    configured: Object.fromEntries(rows.map((row) => [row.id, row.configured])),
    rows,
    security,
  };
}

/**
 * Read-only capability report for UI honesty. Cached for the session; a failed
 * fetch returns an empty report (callers treat unknown as not configured).
 */
export function useRuntimeCapabilities(): {
  loaded: boolean;
  configured: Capabilities;
  rows: CapabilityRow[];
  security: CapabilitySecurity | null;
  dataMode: DataMode;
  refresh: () => void;
} {
  const dataMode = currentDataMode();
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<{
    loaded: boolean;
    configured: Capabilities;
    rows: CapabilityRow[];
    security: CapabilitySecurity | null;
  }>({
    loaded: dataMode !== "production",
    configured: {},
    rows: [],
    security: null,
  });

  const refresh = useCallback(() => {
    capabilityPromise = null;
    setState({ loaded: false, configured: {}, rows: [], security: null });
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (dataMode !== "production") {
      setState({ loaded: true, configured: {}, rows: [], security: null });
      return;
    }
    let cancelled = false;
    capabilityPromise ??= loadCapabilities().catch(() => {
      // Allow a later mount to retry after a transient failure.
      capabilityPromise = null;
      return { configured: {}, rows: [], security: null };
    });
    void capabilityPromise.then((report) => {
      if (!cancelled) setState({ loaded: true, ...report });
    });
    return () => {
      cancelled = true;
    };
  }, [dataMode, reloadToken]);

  return { ...state, dataMode, refresh };
}
