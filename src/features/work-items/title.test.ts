import { describe, expect, it } from "vitest";

import { describeWorkItemTitle } from "./title";

// Titles are written in English when the work item is created and stay that
// way; the queue describes them in the UI language.
describe("describeWorkItemTitle", () => {
  it.each([
    ["Set up new annual return case", "建立周年申報案件"],
    ["Review annual return status: Client reminder sent", "覆核周年申報狀態：已提醒客戶"],
    ["Review document: Register of directors", "覆核文件：董事登記冊（Register of directors）"],
    ["Review payment: INV-2026-001", "覆核付款：INV-2026-001"],
    ["Review filing proof: NAR1-2026-001", "覆核遞交證明：NAR1-2026-001"],
    ["Process name change request", "處理更改公司名稱申請"],
    ["Process share transfer request", "處理股份轉讓申請"],
    ["Process officer change request", "處理高級人員委任／辭任／資料變更申請"],
    ["Process address change request", "處理更改註冊辦事處地址申請"],
    ["Annual return 2026 - Kowloon Textiles Ltd", "2026 年周年申報 - Kowloon Textiles Ltd"],
  ])("describes %j", (title, description) => {
    expect(describeWorkItemTitle(title)).toBe(description);
  });

  it("shows a title it does not recognise exactly as written", () => {
    expect(describeWorkItemTitle("跟進客戶簽署")).toBe("跟進客戶簽署");
  });
});
