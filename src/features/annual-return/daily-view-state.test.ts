import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { dailyReturnPath, dailyViewSearch, caseReturnPath } from "./daily-view-state";

describe("Today return search through the real router serializers", () => {
  it.each(["12345", '["中文公司",2026]', "海港公司"])(
    "retains search %s and both continuation strings on detail return and reload",
    (q) => {
      const expected = {
        view: "returnsAndExceptions" as const,
        q,
        sort: "company" as const,
        cursor: '["company","2026-10-23","海港公司","00000000-0000-0000-0000-000000000001"]',
        otherCursor: '{"context":"owned-page-3","id":"00000000-0000-0000-0000-000000000002"}',
      };
      const returnTo = dailyReturnPath(expected);
      const detailSearch = defaultParseSearch(defaultStringifySearch({ returnTo })) as {
        returnTo: unknown;
      };
      const safeReturn = caseReturnPath(detailSearch.returnTo);
      const parsed = defaultParseSearch(new URL(safeReturn, "https://local.test").search);
      expect(parsed).toEqual(expected);
      expect(dailyViewSearch(parsed)).toEqual(expected);
      expect(defaultParseSearch(defaultStringifySearch(dailyViewSearch(parsed)))).toEqual(expected);
    },
  );

  it("does not add unrelated or private fields to return URLs", () => {
    const input = {
      view: "chaseToday" as const,
      q: "",
      sort: "deadline" as const,
      token: "private",
      snapshot: "private",
    };
    const path = dailyReturnPath(input);
    expect(defaultParseSearch(new URL(path, "https://local.test").search)).toEqual({
      view: "chaseToday",
      q: "",
      sort: "deadline",
    });
  });
});
