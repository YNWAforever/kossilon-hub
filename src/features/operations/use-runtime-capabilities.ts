import { useEffect, useState } from "react";

import { currentDataMode, type DataMode } from "@/features/runtime/data-mode";

type Capabilities = Record<string, boolean>;

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

let capabilityPromise: Promise<Capabilities> | null = null;

async function loadCapabilities(): Promise<Capabilities> {
  const response = await fetch("/api/capabilities", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`capabilities unavailable: ${response.status}`);
  const body = (await response.json()) as {
    capabilities?: { id?: string; configured?: boolean }[];
  };
  return Object.fromEntries(
    (body.capabilities ?? []).flatMap((capability) =>
      capability.id ? [[capability.id, capability.configured === true] as const] : [],
    ),
  );
}

/**
 * Read-only capability report for UI honesty. Cached for the session; a failed
 * fetch returns an empty map (callers treat unknown as not configured).
 */
export function useRuntimeCapabilities(): {
  loaded: boolean;
  configured: Capabilities;
  dataMode: DataMode;
} {
  const dataMode = currentDataMode();
  const [state, setState] = useState<{ loaded: boolean; configured: Capabilities }>({
    loaded: dataMode !== "production",
    configured: {},
  });

  useEffect(() => {
    if (dataMode !== "production") {
      setState({ loaded: true, configured: {} });
      return;
    }
    let cancelled = false;
    capabilityPromise ??= loadCapabilities().catch(() => {
      // Allow a later mount to retry after a transient failure.
      capabilityPromise = null;
      return {};
    });
    void capabilityPromise.then((configured) => {
      if (!cancelled) setState({ loaded: true, configured });
    });
    return () => {
      cancelled = true;
    };
  }, [dataMode]);

  return { ...state, dataMode };
}
