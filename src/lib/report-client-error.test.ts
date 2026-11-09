// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { reportClientError } from "./report-client-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportClientError", () => {
  it("posts a small JSON body and never returns a promise", () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(() =>
      reportClientError({ message: "boom", path: "/dashboard", digest: "d1" }),
    ).not.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/client-errors",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as unknown;
    expect(body).toEqual({ message: "boom", path: "/dashboard", digest: "d1" });
  });

  it("swallows a synchronously throwing fetch", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("network blocked");
    });

    expect(() => reportClientError({ message: "boom" })).not.toThrow();
  });

  it("swallows an asynchronous rejection", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    expect(() => reportClientError({ message: "boom" })).not.toThrow();
    await Promise.resolve();
  });
});
