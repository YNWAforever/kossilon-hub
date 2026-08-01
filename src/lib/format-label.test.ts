import { describe, expect, it } from "vitest";
import { labelValue } from "./format-label";

describe("labelValue", () => {
  it("title-cases a kebab-case database value", () => {
    expect(labelValue("payment-pending")).toBe("Payment Pending");
    expect(labelValue("available")).toBe("Available");
  });

  // These four are the regression. Each one used to throw inside .split(),
  // and because this runs during render, the throw reached the root error
  // boundary and replaced the whole route with "Something went wrong".
  it("renders a placeholder for a NULL column instead of crashing the route", () => {
    expect(labelValue(null)).toBe("—");
  });

  it("renders a placeholder for a field JSON.stringify dropped in transit", () => {
    // undefined properties do not survive serialisation, so a field the server
    // left undefined arrives at the client absent rather than null.
    expect(labelValue(undefined)).toBe("—");
  });

  it("renders a placeholder for an empty string rather than an empty cell", () => {
    expect(labelValue("")).toBe("—");
  });

  it("still formats values it does not recognise, rather than hiding them", () => {
    // The type says DocumentCategory, but the column is plain text and the
    // database is not owned by this code.
    expect(labelValue("bank-statement")).toBe("Bank Statement");
  });
});
