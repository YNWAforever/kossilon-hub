import { describe, expect, it, vi } from "vitest";

const configureZod = vi.hoisted(() => vi.fn());
vi.mock("zod", () => ({ config: configureZod }));

import { configureCspSafeZod } from "./csp-safe-zod";

describe("configureCspSafeZod", () => {
  it("disables zod JIT only in the browser", () => {
    configureCspSafeZod(false);
    expect(configureZod).not.toHaveBeenCalled();

    configureCspSafeZod(true);
    expect(configureZod).toHaveBeenCalledWith({ jitless: true });
  });
});
