import { describe, expect, it } from "vitest";
import { ClientWriteError, rethrowClientWriteError, toClientWriteError } from "./errors";

function postgresError(code: string, constraint: string): Error {
  const error = new Error("postgres rejected the statement") as Error & {
    code: string;
    constraint_name: string;
  };
  error.code = code;
  error.constraint_name = constraint;
  return error;
}

describe("toClientWriteError", () => {
  it("maps a duplicate CR number to the crNumber field", () => {
    const mapped = toClientWriteError(postgresError("23505", "companies_cr_number_key"));

    expect(mapped).toBeInstanceOf(ClientWriteError);
    expect(mapped?.field).toBe("crNumber");
    expect(mapped?.message).toBe("A company with this CR number already exists.");
  });

  it("maps a duplicate BR number to the brNumber field", () => {
    const mapped = toClientWriteError(postgresError("23505", "companies_br_number_key"));

    expect(mapped?.field).toBe("brNumber");
    expect(mapped?.message).toBe("A company with this BR number already exists.");
  });

  it("maps an unreachable contact to the contact field", () => {
    const mapped = toClientWriteError(postgresError("23514", "company_contacts_reachable_check"));

    expect(mapped?.field).toBe("contact");
    expect(mapped?.message).toBe("Provide an email or a phone number.");
  });

  it("maps a duplicate primary contact to the isPrimary field", () => {
    const mapped = toClientWriteError(postgresError("23505", "company_contacts_primary_uidx"));

    expect(mapped?.field).toBe("isPrimary");
    expect(mapped?.message).toBe("This company already has a primary contact.");
  });

  it("returns null for an unrelated constraint", () => {
    expect(toClientWriteError(postgresError("23505", "teams_name_key"))).toBeNull();
  });

  it("returns null for a non-postgres error", () => {
    expect(toClientWriteError(new Error("network down"))).toBeNull();
    expect(toClientWriteError("not an error")).toBeNull();
  });
});

describe("rethrowClientWriteError", () => {
  it("throws a ClientWriteError with the right field for a recognised constraint", () => {
    expect(() =>
      rethrowClientWriteError(postgresError("23505", "companies_cr_number_key")),
    ).toThrow(ClientWriteError);

    try {
      rethrowClientWriteError(postgresError("23505", "companies_cr_number_key"));
    } catch (error) {
      expect(error).toBeInstanceOf(ClientWriteError);
      expect((error as ClientWriteError).field).toBe("crNumber");
    }
  });

  it("rethrows the original error object unchanged for an unrecognised constraint", () => {
    const original = postgresError("23505", "teams_name_key");

    try {
      rethrowClientWriteError(original);
      throw new Error("expected rethrowClientWriteError to throw");
    } catch (error) {
      expect(error).toBe(original);
    }
  });
});
