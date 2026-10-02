import { describe, expect, it, vi } from "vitest";
import {
  createHandoffDestinationForProviderMode,
  createLiveHandoffDestination,
} from "./handoff-destination";

/**
 * A contract test against a stub transport. No real destination is contacted and
 * none could be: BLOCKED_INTEGRATION: external-handoff-destination, no binding
 * for the firm's internal server exists, and
 * createHandoffDestinationForProviderMode returns null in every mode.
 */

const config = { endpoint: "https://agent.example/handoff", apiKey: "test-key" };
const MANIFEST = "a".repeat(64);

const submission = {
  handoffId: "11111111-1111-4111-8111-111111111111",
  caseId: "22222222-2222-4222-8222-222222222222",
  manifestSha256: MANIFEST,
  manifestPayload: '{"caseId":"22222222-2222-4222-8222-222222222222","entries":[]}',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function destinationReturning(body: unknown, status = 200) {
  const fetchImpl = vi.fn(async () => jsonResponse(body, status));
  return { destination: createLiveHandoffDestination({ config, fetchImpl }), fetchImpl };
}

describe("createHandoffDestinationForProviderMode", () => {
  it("is null in every mode when no destination is configured", () => {
    for (const mode of ["local", "simulated", "live"] as const) {
      expect(createHandoffDestinationForProviderMode(mode, { config: null })).toBeNull();
    }
  });

  /**
   * No fixture destination, in any mode. A stand-in that accepted every package
   * would mark filings as handed to an agent that never received them -- the
   * confusion Phase C-0 spent its time removing, with a statutory deadline
   * attached.
   */
  it("has no fixture destination to fall back to outside live", () => {
    expect(createHandoffDestinationForProviderMode("local", { config })).toBeNull();
    expect(createHandoffDestinationForProviderMode("simulated", { config })).toBeNull();
    expect(createHandoffDestinationForProviderMode("live", { config })).toBeNull();
  });
});

describe("createLiveHandoffDestination", () => {
  it("sends the manifest the approval was recorded over, and its hash", async () => {
    const { destination, fetchImpl } = destinationReturning({
      reference: "agent-ref-1",
      accepted: true,
    });

    await expect(destination.submit(submission)).resolves.toEqual({
      status: "accepted",
      destinationReference: "agent-ref-1",
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // Quoted in a header so the agent can echo it back and both sides mean the
    // same package.
    expect((init.headers as Record<string, string>)["x-package-manifest-sha256"]).toBe(MANIFEST);
    expect(JSON.parse(init.body as string).manifest).toBe(submission.manifestPayload);
  });

  /**
   * A refusal is not a failure. They received the package and said no, and
   * retrying delivers it again to a destination that has already decided --
   * which is how a duplicate filing happens.
   */
  it("distinguishes a refusal from a failure to reach them", async () => {
    const { destination } = destinationReturning({
      reference: "agent-ref-2",
      accepted: false,
      detail: "NAR1 signature page missing.",
    });

    await expect(destination.submit(submission)).resolves.toEqual({
      status: "refused",
      destinationReference: "agent-ref-2",
      detail: "NAR1 signature page missing.",
    });
  });

  it("never retries a lost acknowledgement or terminal contract refusal", async () => {
    for (const [status, result] of [
      [503, "unknown"],
      [429, "unknown"],
      [400, "failed"],
    ] as const) {
      const { destination } = destinationReturning({}, status);
      await expect(destination.submit(submission)).resolves.toMatchObject({
        status: result,
        retryable: false,
      });
    }
  });

  it("rejects a response that does not carry a reference", async () => {
    const { destination } = destinationReturning({ accepted: true });
    await expect(destination.submit(submission)).resolves.toMatchObject({
      status: "unknown",
      errorCode: "malformed-response",
    });
  });

  // A transport error string can carry an internal address or a token, and this
  // outcome is persisted.
  it("reports a transport failure by class, not by the destination's message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 10.1.2.3:8443 token=secret");
    });
    const destination = createLiveHandoffDestination({ config, fetchImpl });

    const result = await destination.submit(submission);
    expect(result).toEqual({ status: "unknown", retryable: false, errorCode: "transport" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("an accepted request whose response body never arrives times out as unknown once", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const destination = createLiveHandoffDestination({ config, fetchImpl, timeoutMs: 10 });
    await expect(destination.submit(submission)).resolves.toMatchObject({
      status: "unknown",
      retryable: false,
      errorCode: "timeout",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
