import { describe, expect, it } from "vitest";
import { otherWorkRow, type OtherWorkSource } from "./work-views-other";

const source: OtherWorkSource = {
  business: "incorporation",
  id: "11111111-1111-4111-8111-111111111111",
  companyName: "海港新公司",
  ownerId: "owner",
  ownerName: "Ada",
  reviewerId: null,
  reviewerName: null,
  dueDate: "2026-10-22",
  status: "Documents pending",
  statusAt: "2026-10-22T16:30:00Z",
  completedAt: null,
  requiredCount: 2,
  missingLabels: ["公司章程"],
  receivedCount: 1,
};

describe("Today other-business read projection", () => {
  it("opens incorporation in its own domain with deadline, owner and first next action", () => {
    expect(otherWorkRow(source, "2026-10-23")).toMatchObject({
      business: "incorporation",
      target: "/incorporation/$id",
      caseId: source.id,
      companyName: "海港新公司",
      ownerName: "Ada",
      reviewerName: null,
      dueDate: "2026-10-22",
      daysRemaining: -1,
      statusAt: "2026-10-22T16:30:00Z",
      blocker: "公司章程",
      nextStep: "追收及核對缺少文件",
      readyForApproval: false,
    });
  });
  it("opens corporate changes in the correct domain without inventing unknown deadline/reviewer", () => {
    expect(
      otherWorkRow({ ...source, business: "corporate_change", dueDate: null }, "2026-10-23"),
    ).toMatchObject({
      target: "/corporate-changes/$id",
      dueDate: null,
      daysRemaining: null,
      reviewerName: null,
    });
  });
  it("keeps received documents on internal review rather than asking the client to resend", () => {
    expect(
      otherWorkRow({ ...source, missingLabels: [], receivedCount: 1 }, "2026-10-23"),
    ).toMatchObject({
      blocker: "1 份文件待內部覆核",
      nextStep: "覆核已收到文件",
      readyForApproval: false,
    });
  });
  it("does not turn a Ready label and verified checklist into canonical filing readiness", () => {
    expect(
      otherWorkRow(
        { ...source, status: "Ready to file", missingLabels: [], receivedCount: 0 },
        "2026-10-23",
      ),
    ).toMatchObject({ blocker: "交件資格尚待個案證據核實", readyForApproval: false });
  });
  it("does not call an unknown requirement set complete", () => {
    expect(
      otherWorkRow(
        { ...source, requiredCount: 0, missingLabels: [], receivedCount: 0 },
        "2026-10-23",
      ),
    ).toMatchObject({ blocker: "文件需求未能判定", nextStep: "確認文件需求及負責人" });
  });
  it.each(["incorporation", "corporate_change"] as const)(
    "%s keeps a fully verified Documents pending case on explicit manual follow-up",
    (business) => {
      const row = otherWorkRow(
        { ...source, business, status: "Documents pending", missingLabels: [], receivedCount: 0 },
        "2026-10-23",
      );
      expect(row).not.toBeNull();
      expect(row!.caseId).toBe(source.id);
      expect(row!.blocker).toMatch(/未完成/);
      expect(row!.nextStep).toMatch(/人手/);
      expect(row!.readyForApproval).toBe(false);
    },
  );
  it.each(["Completed", "Cancelled"])(
    "excludes closed %s work even with stale checklist data",
    (status) => {
      expect(otherWorkRow({ ...source, status }, "2026-10-23")).toBeNull();
    },
  );
  it("keeps filed-with-Registrar followup distinct from completed work", () => {
    expect(otherWorkRow({ ...source, status: "Filed with Registrar" }, "2026-10-23")).toMatchObject(
      { blocker: "已提交登記處，等待結果核對", nextStep: "核對登記結果及回件" },
    );
  });
  it("does not expose a completed timestamp under a stale open status", () => {
    expect(
      otherWorkRow({ ...source, completedAt: "2026-10-22T00:00:00Z" }, "2026-10-23"),
    ).toBeNull();
  });
});
