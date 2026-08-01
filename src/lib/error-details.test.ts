import { describe, expect, it } from "vitest";

import { errorDetails } from "@/lib/error-details";

describe("errorDetails", () => {
  it("carries the route, the error name and the message", () => {
    const error = new Error('relation "documents" does not exist');

    const details = errorDetails(error, "/documents");

    expect(details).toContain("route: /documents");
    expect(details).toContain('Error: relation "documents" does not exist');
  });

  it("includes the stack, which is the part a screenshot of the page could not give you", () => {
    const error = new Error("boom");

    expect(errorDetails(error, "/documents")).toContain(error.stack!);
  });

  it("survives a thrown non-Error, which is what an unhandled rejection often is", () => {
    const details = errorDetails("just a string", "/portal");

    expect(details).toContain("route: /portal");
    expect(details).toContain("string: just a string");
    expect(details).toContain("(no stack)");
  });

  it("says so rather than rendering nothing when the message is empty", () => {
    // An Error with no message used to render as a blank panel, which reads as
    // "the diagnostic is broken too".
    expect(errorDetails(new Error(""), "/")).toContain("Error: ");
  });
});
