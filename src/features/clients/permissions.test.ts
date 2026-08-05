import { describe, expect, it } from "vitest";
import { assertClientActionAllowed, canPerformClientAction, type ClientActor } from "./permissions";

function actor(overrides: Partial<ClientActor> = {}): ClientActor {
  return {
    userId: "20000000-0000-0000-0000-000000000001",
    role: "Staff",
    active: true,
    ...overrides,
  };
}

describe("canPerformClientAction", () => {
  it("lets active staff view the register and edit details", () => {
    expect(canPerformClientAction(actor(), "view_register")).toBe(true);
    expect(canPerformClientAction(actor(), "edit_details")).toBe(true);
  });

  it("refuses staff the managed actions", () => {
    expect(canPerformClientAction(actor(), "create_client")).toBe(false);
    expect(canPerformClientAction(actor(), "deactivate_client")).toBe(false);
    expect(canPerformClientAction(actor(), "reassign_client")).toBe(false);
  });

  it("lets managers and admins perform the managed actions", () => {
    for (const role of ["Manager", "Admin"] as const) {
      expect(canPerformClientAction(actor({ role }), "create_client")).toBe(true);
      expect(canPerformClientAction(actor({ role }), "deactivate_client")).toBe(true);
      expect(canPerformClientAction(actor({ role }), "reassign_client")).toBe(true);
    }
  });

  it("refuses an inactive actor every action, including an admin", () => {
    for (const role of ["Staff", "Manager", "Admin"] as const) {
      expect(canPerformClientAction(actor({ role, active: false }), "view_register")).toBe(false);
      expect(canPerformClientAction(actor({ role, active: false }), "create_client")).toBe(false);
    }
  });

  it("refuses the Client role even when active", () => {
    expect(canPerformClientAction(actor({ role: "Client" }), "view_register")).toBe(false);
    expect(canPerformClientAction(actor({ role: "Client" }), "edit_details")).toBe(false);
  });

  it("refuses a staff role with no database identity", () => {
    expect(canPerformClientAction(actor({ userId: null }), "view_register")).toBe(false);
  });
});

describe("assertClientActionAllowed", () => {
  it("returns the actor when the action is allowed", () => {
    const allowed = actor({ role: "Manager" });
    expect(assertClientActionAllowed(allowed, "create_client")).toBe(allowed);
  });

  it("throws a Forbidden error naming the reason for an inactive actor", () => {
    expect(() => assertClientActionAllowed(actor({ active: false }), "view_register")).toThrow(
      "Forbidden: inactive users cannot access the client register.",
    );
  });

  it("throws a Forbidden error for a Client role", () => {
    expect(() => assertClientActionAllowed(actor({ role: "Client" }), "view_register")).toThrow(
      "Forbidden: staff access is required.",
    );
  });

  it("throws a Forbidden error naming the action a staff member may not perform", () => {
    expect(() => assertClientActionAllowed(actor(), "reassign_client")).toThrow(
      "Forbidden: reassign_client requires a Manager or an Admin.",
    );
  });

  it("throws when a staff actor has no database identity", () => {
    expect(() => assertClientActionAllowed(actor({ userId: null }), "edit_details")).toThrow(
      "Forbidden: a staff database identity is required.",
    );
  });
});
