import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  load: (source: string, options?: { maxTotalMergeKeys: number }) => unknown;
};

describe("installed build parser security contract (GHSA-2883-xcg3-v3hh)", () => {
  it("charges empty merge sources against the explicit work budget", () => {
    const source = "empty: &empty [{}, {}, {}]\ntarget:\n  <<: *empty\n";
    expect(() => yaml.load(source, { maxTotalMergeKeys: 2 })).toThrow(/merge|limit/i);
  });

  it("preserves a normal permitted merge and Unicode config", () => {
    const source = "base: &base {label: 香港}\ntarget:\n  <<: *base\n  enabled: true\n";
    expect(yaml.load(source, { maxTotalMergeKeys: 8 })).toEqual({
      base: { label: "香港" },
      target: { label: "香港", enabled: true },
    });
  });
});
