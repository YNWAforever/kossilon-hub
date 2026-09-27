import { describe, expect, it } from "vitest";

import { boardFiltersFromSearch, boardSearchFromUrl } from "./board-filters";

describe("boardFiltersFromSearch", () => {
  it("asks only for the page size when no filter is set", () => {
    expect(boardFiltersFromSearch({}, 200)).toEqual({ limit: 200 });
  });

  it("passes the server-side filters through", () => {
    expect(
      boardFiltersFromSearch(
        { status: "Filed", risk: "red", ownerId: "owner-1", overdueOnly: true },
        200,
      ),
    ).toEqual({
      limit: 200,
      status: "Filed",
      risk: "red",
      ownerId: "owner-1",
      overdueOnly: true,
    });
  });

  it("omits absent filters rather than sending undefined", () => {
    // Sending `{ status: undefined }` would change the query key on every render
    // and hand the Zod schema a different shape than an unfiltered read.
    expect(Object.keys(boardFiltersFromSearch({ status: "Filed" }, 200)).sort()).toEqual([
      "limit",
      "status",
    ]);
  });

  // This used to assert the opposite, on the reasoning that a production case
  // carries no contact name or phone. But the consequence was that `q` filtered
  // only the rows already returned, so a case at row 201 could not be found by
  // typing its name at all. It is now a SQL predicate over company name and CR
  // number.
  it("sends the company search to the server as a real predicate", () => {
    expect(boardFiltersFromSearch({ q: "acme" }, 200)).toEqual({ limit: 200, q: "acme" });
  });

  it("omits an absent search rather than sending an empty string", () => {
    expect(boardFiltersFromSearch({}, 200)).toEqual({ limit: 200 });
    expect(boardFiltersFromSearch({ q: "" }, 200)).toEqual({ limit: 200 });
  });

  it("forwards a page cursor only when one was supplied", () => {
    expect(boardFiltersFromSearch({}, 200, "abc")).toEqual({ limit: 200, cursor: "abc" });
    expect(boardFiltersFromSearch({}, 200, undefined)).toEqual({ limit: 200 });
  });

  it("drops overdueOnly when it is false", () => {
    expect(boardFiltersFromSearch({ overdueOnly: false }, 200)).toEqual({ limit: 200 });
  });
});

describe("boardSearchFromUrl", () => {
  const empty = {
    q: undefined,
    status: undefined,
    risk: undefined,
    ownerId: undefined,
    overdueOnly: undefined,
    bulkOperation: undefined,
  };

  it("keeps a valid status and risk", () => {
    expect(boardSearchFromUrl({ status: "Filed", risk: "red" })).toEqual({
      ...empty,
      status: "Filed",
      risk: "red",
    });
  });

  it("drops an unknown status rather than sending it to the server", () => {
    expect(boardSearchFromUrl({ status: "NotAStatus" })).toEqual(empty);
  });

  it("drops an unknown risk level", () => {
    expect(boardSearchFromUrl({ risk: "purple" })).toEqual(empty);
  });

  it("accepts overdueOnly as a boolean or as the string a URL carries", () => {
    expect(boardSearchFromUrl({ overdueOnly: true }).overdueOnly).toBe(true);
    expect(boardSearchFromUrl({ overdueOnly: "true" }).overdueOnly).toBe(true);
    expect(boardSearchFromUrl({ overdueOnly: "false" }).overdueOnly).toBeUndefined();
  });

  it("preserves only a valid durable bulk operation ID in the URL", () => {
    const id = "30000000-0000-0000-0000-000000000001";
    expect(boardSearchFromUrl({ bulkOperation: id }).bulkOperation).toBe(id);
    expect(boardSearchFromUrl({ bulkOperation: "invalid" }).bulkOperation).toBeUndefined();
    expect(boardFiltersFromSearch({ bulkOperation: id }, 200)).toEqual({ limit: 200 });
  });

  it("treats an empty search box as no filter", () => {
    expect(boardSearchFromUrl({ q: "" })).toEqual(empty);
  });

  it("ignores non-string values where a string is expected", () => {
    expect(boardSearchFromUrl({ q: 42, ownerId: { id: 1 } })).toEqual(empty);
  });
});
