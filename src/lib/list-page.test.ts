import { expect, it } from "vitest";
import { encodeListCursor, decodeListCursor } from "./list-page";
it("round-trips Chinese cursor values as UTF8 and preserves earlier ASCII cursors", () => {
  const key = "中文 scope",
    values = ["陳大文 · 香港團隊", "工作類型"];
  expect(decodeListCursor(encodeListCursor(key, values), key, 2)).toEqual(values);
  const old = btoa(JSON.stringify({ v: 1, key: encodeURIComponent(key), values: ["ascii", "id"] }));
  expect(decodeListCursor(old, key, 2)).toEqual(["ascii", "id"]);
});
