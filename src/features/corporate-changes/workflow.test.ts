import { describe, expect, it } from "vitest";
import { checklistLabelsFor, isAllowedCorporateChangeStatusTransition } from "./workflow";

describe("isAllowedCorporateChangeStatusTransition", () => {
  it("allows moving forward one step in the lifecycle", () => {
    expect(isAllowedCorporateChangeStatusTransition("Requested", "Documents pending")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Documents pending", "Ready to file")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Ready to file", "Filed with Registrar")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Filed with Registrar", "Completed")).toBe(true);
  });

  it("rejects skipping a step", () => {
    expect(isAllowedCorporateChangeStatusTransition("Requested", "Ready to file")).toBe(false);
  });

  it("rejects moving backward", () => {
    expect(isAllowedCorporateChangeStatusTransition("Ready to file", "Requested")).toBe(false);
  });

  it("allows cancelling from any non-terminal status", () => {
    expect(isAllowedCorporateChangeStatusTransition("Requested", "Cancelled")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Documents pending", "Cancelled")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Filed with Registrar", "Cancelled")).toBe(true);
  });

  it("rejects cancelling a terminal request", () => {
    expect(isAllowedCorporateChangeStatusTransition("Completed", "Cancelled")).toBe(false);
    expect(isAllowedCorporateChangeStatusTransition("Cancelled", "Cancelled")).toBe(false);
  });
});

describe("checklistLabelsFor", () => {
  it("returns the fixed name_change document set", () => {
    expect(checklistLabelsFor("name_change")).toEqual([
      "Special resolution approving new name",
      "NNC2 form",
      "Updated Business Registration certificate",
      "Certificate of Change of Name",
    ]);
  });

  it("returns the fixed share_transfer document set", () => {
    expect(checklistLabelsFor("share_transfer")).toEqual([
      "Bought & Sold Note",
      "Instrument of Transfer",
      "Transferee ID/address proof",
      "Stamp duty payment receipt",
      "Updated register of members",
    ]);
  });

  it("returns the fixed officer_change document set", () => {
    expect(checklistLabelsFor("officer_change")).toEqual([
      "ND2A/ND2B form",
      "New officer's ID/address proof",
      "Updated register of directors and secretaries",
    ]);
  });

  it("returns the fixed address_change document set", () => {
    expect(checklistLabelsFor("address_change")).toEqual([
      "NR1 form",
      "Proof of new address",
      "Updated Business Registration certificate",
    ]);
  });
});
