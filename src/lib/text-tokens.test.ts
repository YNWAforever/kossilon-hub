import { describe, expect, it } from "vitest";
import { tokenize } from "./text-tokens";

describe("tokenize", () => {
  // The defect this file exists for. Both old tokenizers normalised with an
  // ASCII-only class, so every Chinese message retrieved nothing at all.
  it("returns tokens for a Chinese question", () => {
    expect(tokenize("請問週年申報表的費用是多少？")).not.toEqual([]);
    expect(tokenize("陳大文董事身分證")).not.toEqual([]);
  });

  it("splits Chinese into overlapping bigrams", () => {
    expect(tokenize("身分證明文件")).toEqual(["身分", "分證", "證明", "明文", "文件"]);
  });

  it("lets a Chinese query overlap a longer Chinese phrase", () => {
    const query = new Set(tokenize("身分證"));
    const overlap = tokenize("身分證明文件").filter((token) => query.has(token));
    expect(overlap).toEqual(["身分", "分證"]);
  });

  it("keeps a lone Chinese character rather than dropping it", () => {
    expect(tokenize("稅")).toEqual(["稅"]);
  });

  it("still tokenises English exactly as before", () => {
    expect(tokenize("annual return fee")).toEqual(["annual", "return", "fee"]);
  });

  it("keeps the pre-existing short-word rule for Latin", () => {
    expect(tokenize("we go to HK")).toEqual([]);
    expect(tokenize("nar1 form")).toEqual(["nar1", "form"]);
  });

  it("separates Chinese from Latin in a mixed string", () => {
    expect(tokenize("NAR1 週年申報")).toEqual(["nar1", "週年", "年申", "申報"]);
  });

  it("does not join two Chinese runs across the punctuation between them", () => {
    // 報 and 費 are not adjacent in the source text, so 報費 must not exist.
    expect(tokenize("申報，費用")).toEqual(["申報", "費用"]);
  });

  it("returns nothing for punctuation alone", () => {
    expect(tokenize("？！，。 ...")).toEqual([]);
  });
});
