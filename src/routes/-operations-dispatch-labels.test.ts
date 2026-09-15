import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./operations.tsx", import.meta.url), "utf8");

// `dispatchCountLabel(entry.dispatch?.sent ?? 0)` would compile cleanly, render
// an unrecorded dispatch as "0", and fail no other test -- the whole point of
// dispatchCountLabel is the distinction between "zero" and "unknown", and a
// `?? 0` at the call site destroys it one hop before the function ever sees
// the value.
describe("operations dispatch labels", () => {
  it("passes null, not 0, for an unrecorded dispatch count", () => {
    expect(source).toContain("dispatch?.sent ?? null");
    expect(source).toContain("dispatch?.suppressedFixtureOrigin ?? null");
  });

  it("never defaults a dispatch count to zero at the call site", () => {
    expect(source).not.toMatch(/dispatch\?\.\w+ \?\? 0/);
  });
});
