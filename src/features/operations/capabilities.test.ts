import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCKED_INTEGRATIONS, blockedIntegrationIds } from "./capabilities";

/**
 * The inventory has to stay true to the code, in both directions.
 *
 * A marker in the source with no entry means a capability is disabled and the
 * operations screen does not say so. An entry with no marker means this file is
 * still claiming something is off after the code stopped saying it was -- which
 * is the direction that rots quietly, because nothing else in a build would ever
 * notice.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

// Excluded so the inventory cannot satisfy its own test, and so the marker
// strings written in this file do not become phantom ids.
const SELF = ["capabilities.ts", "capabilities.test.ts"];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (SELF.includes(entry)) continue;
    found.push(path);
  }
  return found;
}

function markersInSource(): Map<string, string[]> {
  const markers = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(/BLOCKED_INTEGRATION:\s*([a-z0-9-]+)/g)) {
      const id = match[1];
      markers.set(id, [...(markers.get(id) ?? []), file.slice(SRC.length)]);
    }
  }
  return markers;
}

describe("blocked integration inventory", () => {
  const markers = markersInSource();
  const declared = new Set<string>(blockedIntegrationIds());

  it("finds the markers it is checking against", () => {
    // Guards the test itself: a walker that found nothing would make both
    // directions below pass vacuously.
    expect(markers.size).toBeGreaterThan(3);
  });

  it("declares every integration the source marks as blocked", () => {
    const undeclared = [...markers.keys()].filter((id) => !declared.has(id));

    expect(
      undeclared,
      `These have BLOCKED_INTEGRATION markers in src/ but no entry in capabilities.ts, ` +
        `so the operations screen does not tell anyone the capability is off: ` +
        undeclared.map((id) => `${id} (${markers.get(id)?.join(", ")})`).join("; "),
    ).toEqual([]);
  });

  it("does not claim an integration is blocked after the code stopped saying so", () => {
    const stale = [...declared].filter((id) => !markers.has(id));

    expect(
      stale,
      `These are declared blocked in capabilities.ts but no BLOCKED_INTEGRATION marker ` +
        `remains in src/. Either the integration shipped and this entry should go, or the ` +
        `marker was deleted and the code no longer says what it is doing: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("gives every entry a specific input that would clear it", () => {
    for (const integration of BLOCKED_INTEGRATIONS) {
      expect(integration.clearedBy.length, integration.id).toBeGreaterThan(10);
      expect(integration.effect.length, integration.id).toBeGreaterThan(10);
      // A pilot has to know what to do instead, or "disabled" is just a shrug.
      expect(integration.pilotFallback.length, integration.id).toBeGreaterThan(10);
    }
  });

  it("has no duplicate ids", () => {
    expect(new Set(blockedIntegrationIds()).size).toBe(BLOCKED_INTEGRATIONS.length);
  });
});
