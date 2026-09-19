import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_INTEGRATIONS,
  blockedIntegrationIds,
  staleBlockedIntegrations,
  runtimeCheckedIds,
  releaseBlockingIntegrations,
  type BlockedIntegrationId,
  type BlockedIntegration,
} from "./capabilities";

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

  it("reports the release-blocking entries from the data rather than a prose count", () => {
    expect(releaseBlockingIntegrations().map((item) => item.id)).toEqual(
      BLOCKED_INTEGRATIONS.filter((item) => item.blocksRelease).map((item) => item.id),
    );
  });
});

/**
 * Empty since `local-postgres` was retired -- there are no build-kind blockers
 * left. Kept because the next one needs somewhere to declare its evidence, and
 * the guard below is what stops it being added without a check.
 */
const BUILD_EVIDENCE: Partial<Record<BlockedIntegrationId, () => boolean>> = {};

describe("blocked integrations that may have outlived their cause", () => {
  /**
   * A `build` entry with no evidence function would look checked and never be
   * -- the same defect this mechanism exists to catch, one level up.
   */
  it("has an evidence check for every build-kind entry", () => {
    const unchecked = BLOCKED_INTEGRATIONS.filter(
      (item) => item.evidence.observable === "build" && !BUILD_EVIDENCE[item.id],
    ).map((item) => item.id);

    expect(unchecked).toEqual([]);
  });

  /**
   * The check itself. It does not clear anything -- it fails, and a person
   * deletes the entry. A product that re-asserted its own capabilities from a
   * heuristic would be the dangerous direction of this same idea.
   */
  it("does not still list a blocker whose build evidence is present", () => {
    const stale = BLOCKED_INTEGRATIONS.filter(
      (item) => item.evidence.observable === "build" && BUILD_EVIDENCE[item.id]?.() === true,
    ).map((item) => item.id);

    expect(stale, `these blockers look cleared and should be deleted: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("gives every external entry a reason nothing can check it", () => {
    for (const item of BLOCKED_INTEGRATIONS) {
      if (item.evidence.observable !== "external") continue;
      expect(item.evidence.why.length, `${item.id} needs a why`).toBeGreaterThan(10);
    }
  });
});

function entry(overrides: Partial<BlockedIntegration>): BlockedIntegration {
  return {
    id: "deployment-runtime",
    capability: "x",
    effect: "x",
    pilotFallback: "x",
    clearedBy: "x",
    blocksRelease: true,
    evidence: { observable: "runtime" },
    ...overrides,
  };
}

describe("staleBlockedIntegrations", () => {
  it("says nothing while the evidence is absent", () => {
    expect(
      staleBlockedIntegrations({
        blocked: [entry({})],
        maintenanceState: "never-observed",
        textLayerObserved: false,
      }),
    ).toEqual([]);
  });

  /**
   * Any state other than `never-observed` means a scheduled run has been
   * recorded, which is exactly what `deployment-runtime` says would clear it.
   */
  it("flags the entry once a scheduled run has been observed", () => {
    expect(
      staleBlockedIntegrations({
        blocked: [entry({})],
        maintenanceState: "healthy",
        textLayerObserved: false,
      }),
    ).toEqual(["deployment-runtime"]);
  });

  it("flags it even when the schedule is unhealthy, because it still ran", () => {
    expect(
      staleBlockedIntegrations({
        blocked: [entry({})],
        maintenanceState: "stale",
        textLayerObserved: false,
      }),
    ).toEqual(["deployment-runtime"]);
  });

  it("has nothing to say once the entry is gone", () => {
    expect(
      staleBlockedIntegrations({
        blocked: [],
        maintenanceState: "healthy",
        textLayerObserved: false,
      }),
    ).toEqual([]);
  });

  it("never flags an entry whose evidence does not live at runtime", () => {
    const external = entry({ id: "ai-provider", evidence: { observable: "external", why: "x" } });

    expect(
      staleBlockedIntegrations({
        blocked: [external],
        maintenanceState: "healthy",
        textLayerObserved: false,
      }),
    ).toEqual([]);
  });

  /**
   * The same guard the build side has. A runtime entry with no check would look
   * checked and never be.
   */
  it("has an evidence check for every runtime-kind entry", () => {
    const checked = runtimeCheckedIds();
    const unchecked = BLOCKED_INTEGRATIONS.filter(
      (item) => item.evidence.observable === "runtime" && !checked.includes(item.id),
    ).map((item) => item.id);

    expect(unchecked).toEqual([]);
  });

  /**
   * The other direction, which is the one that rots quietly: reclassifying
   * `deployment-runtime` to `external` would leave this key behind, switch off
   * the only live check in the product, and pass every other test.
   */
  it("has no runtime check left over for an entry that no longer claims runtime evidence", () => {
    const runtimeIds = new Set(
      BLOCKED_INTEGRATIONS.filter((item) => item.evidence.observable === "runtime").map(
        (item) => item.id,
      ),
    );

    expect(runtimeCheckedIds().filter((id) => !runtimeIds.has(id))).toEqual([]);
  });

  describe("document-text-extraction", () => {
    const extraction = entry({ id: "document-text-extraction", blocksRelease: false });

    it("stays quiet until a deployed runtime has written a text-layer row", () => {
      expect(
        staleBlockedIntegrations({
          blocked: [extraction],
          maintenanceState: "healthy",
          textLayerObserved: false,
        }),
      ).toEqual([]);
    });

    it("flags the entry once one has", () => {
      expect(
        staleBlockedIntegrations({
          blocked: [extraction],
          maintenanceState: "never-observed",
          textLayerObserved: true,
        }),
      ).toEqual(["document-text-extraction"]);
    });
  });

  it("declares document-text-extraction as runtime evidence", () => {
    const declared = BLOCKED_INTEGRATIONS.find((item) => item.id === "document-text-extraction");
    expect(declared?.evidence).toEqual({ observable: "runtime" });
  });
});
