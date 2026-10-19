import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checklistLabelsFor } from "@/features/corporate-changes/workflow";
import { CORPORATE_CHANGE_TYPES } from "@/features/corporate-changes/types";
import {
  checklistItemChineseName,
  checklistItemText,
  checklistSummaryText,
} from "./checklist-item-label";

describe("checklist item names", () => {
  it("gives a built-in document its Chinese name", () => {
    expect(checklistItemChineseName("Register of directors")).toBe("董事登記冊");
    expect(checklistItemChineseName("  Signed NAR1 form ")).toBe("已簽署的 NAR1 周年申報表");
  });

  it("leaves a name the firm typed itself alone", () => {
    expect(checklistItemChineseName("股東名冊（2026 年版）")).toBeNull();
    expect(checklistItemText("股東名冊（2026 年版）")).toBe("股東名冊（2026 年版）");
  });

  it("keeps the English name beside the Chinese one in running text", () => {
    expect(checklistItemText("Register of directors")).toBe("董事登記冊（Register of directors）");
  });

  it("names each built-in document in a joined summary and keeps the rest", () => {
    expect(checklistSummaryText("Register of directors、地址證明、Signed NAR1 form")).toBe(
      "董事登記冊、地址證明、已簽署的 NAR1 周年申報表",
    );
  });

  // A new built-in document added without a Chinese name would quietly show in
  // English only; these lists are where every built-in name comes from.
  it("names every built-in document", () => {
    const templates = readFileSync(new URL("./templates.ts", import.meta.url), "utf8");
    const templateDocuments = [
      ...templates.matchAll(/documents: \[([\s\S]*?)\],\s*reminders/g),
    ].flatMap(([, block]) => [...block.matchAll(/label: "([^"]+)"/g)].map(([, label]) => label));
    const corporateChange = CORPORATE_CHANGE_TYPES.flatMap((type) => [...checklistLabelsFor(type)]);

    expect(templateDocuments.length).toBeGreaterThan(20);
    expect(
      [...templateDocuments, ...corporateChange].filter(
        (label) => !checklistItemChineseName(label),
      ),
    ).toEqual([]);
  });
});
