import { describe, expect, it } from "vitest";

import {
  normalizeRequestAccess,
  requestAccessDecisionSchema,
  requestAccessSubmissionSchema,
} from "./types";

const valid = {
  name: "  Amy Chan ",
  email: " AMY@Example.TEST ",
  firm: " Example Secretarial Ltd ",
  team: " Team A ",
  message: "  Please invite me.  ",
  consent: true as const,
  website: "",
};

describe("request-access submission", () => {
  it("normalizes whitespace and lower-cases the address", () => {
    const result = normalizeRequestAccess(requestAccessSubmissionSchema.parse(valid));

    expect(result).toEqual({
      name: "Amy Chan",
      email: "amy@example.test",
      firm: "Example Secretarial Ltd",
      team: "Team A",
      message: "Please invite me.",
      honeypot: false,
    });
  });

  it("treats empty optional fields as absent", () => {
    const result = normalizeRequestAccess(
      requestAccessSubmissionSchema.parse({ ...valid, team: "  ", message: "" }),
    );

    expect(result.team).toBeNull();
    expect(result.message).toBeNull();
  });

  it("rejects missing consent, invalid email and an over-long note", () => {
    expect(() => requestAccessSubmissionSchema.parse({ ...valid, consent: false })).toThrow();
    expect(() =>
      requestAccessSubmissionSchema.parse({ ...valid, email: "not-an-email" }),
    ).toThrow();
    expect(() =>
      requestAccessSubmissionSchema.parse({ ...valid, message: "x".repeat(2001) }),
    ).toThrow();
  });

  it("accepts and flags any filled honeypot so spam gets a generic success", () => {
    const parsed = requestAccessSubmissionSchema.parse({ ...valid, website: "spam-bot" });
    expect(normalizeRequestAccess(parsed).honeypot).toBe(true);
  });

  it("only allows approve/reject decisions on a UUID", () => {
    expect(() =>
      requestAccessDecisionSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        status: "approved",
      }),
    ).not.toThrow();
    expect(() =>
      requestAccessDecisionSchema.parse({ id: "not-a-uuid", status: "approved" }),
    ).toThrow();
    expect(() =>
      requestAccessDecisionSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        status: "pending",
      }),
    ).toThrow();
  });
});
