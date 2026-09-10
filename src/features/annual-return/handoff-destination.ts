import { z } from "zod";
import type { ProviderMode } from "@/server/provider-mode";

/**
 * The filing agent's server.
 *
 * BLOCKED_INTEGRATION: external-handoff-destination. The destination is the
 * firm's internal server; its protocol, address, authentication and rights are
 * not known to this repository, and no binding for them is defined. So
 * `createHandoffDestinationForProviderMode` returns null in every mode and
 * nothing transmits.
 *
 * Written anyway, and contract-tested against a stub, for the same reason the AI
 * adapter is: the shape of the contract is the part that has to be right before
 * a protocol is chosen, and a capability that is switched off is a different
 * thing from one that was never built.
 *
 * The shape below is this codebase's requirement, not a guess at the firm's
 * protocol: whatever the transport turns out to be, a handoff has to come back
 * with a reference we can quote to the agent and a way to distinguish "they have
 * it" from "they refused it" from "we could not reach them". If the real server
 * cannot answer those three questions, that is worth discovering before the
 * connector is built rather than after.
 */

const HANDOFF_TIMEOUT_MS = 30_000;

const responseSchema = z.object({
  /** The destination's own identifier, quoted back to the agent in a query. */
  reference: z.string().min(1).max(200),
  accepted: z.boolean(),
  /** Their words when they refuse. Recorded, never parsed into a decision. */
  detail: z.string().max(2000).optional(),
});

export type HandoffSubmission = {
  handoffId: string;
  caseId: string;
  manifestSha256: string;
  /** The exact bytes the approval was recorded over. */
  manifestPayload: string;
};

export type HandoffResult =
  | { status: "accepted"; destinationReference: string }
  /** They received it and refused it. A person deals with this; a retry will not. */
  | { status: "refused"; destinationReference: string; detail: string | null }
  | { status: "failed"; retryable: boolean; errorCode: string };

export type HandoffDestination = {
  submit(submission: HandoffSubmission): Promise<HandoffResult>;
};

export type HandoffDestinationConfig = { endpoint: string; apiKey: string };

export function createLiveHandoffDestination(options: {
  config: HandoffDestinationConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): HandoffDestination {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? HANDOFF_TIMEOUT_MS;

  return {
    async submit(submission): Promise<HandoffResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(options.config.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.config.apiKey}`,
            "content-type": "application/json",
            // So the agent can quote it back and both sides mean the same
            // package. The hash is the package's identity, not a checksum of
            // convenience.
            "x-package-manifest-sha256": submission.manifestSha256,
          },
          body: JSON.stringify({
            handoffId: submission.handoffId,
            caseId: submission.caseId,
            manifestSha256: submission.manifestSha256,
            manifest: submission.manifestPayload,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        // By class, not by message: a transport error string can carry an
        // internal address or a token, and this is persisted.
        return {
          status: "failed",
          retryable: true,
          errorCode:
            error instanceof Error && error.name === "AbortError" ? "timeout" : "transport",
        };
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        return { status: "failed", retryable, errorCode: `http-${response.status}` };
      }

      let parsed: z.infer<typeof responseSchema>;
      try {
        parsed = responseSchema.parse(await response.json());
      } catch {
        return { status: "failed", retryable: false, errorCode: "malformed-response" };
      }

      // A refusal is not a failure. They received the package and said no, and
      // retrying delivers it again to a destination that has already decided --
      // which is how a duplicate filing happens.
      return parsed.accepted
        ? { status: "accepted", destinationReference: parsed.reference }
        : {
            status: "refused",
            destinationReference: parsed.reference,
            detail: parsed.detail ?? null,
          };
    },
  };
}

/**
 * Null in every mode, today and until a protocol is chosen.
 *
 * No fixture destination exists, in any mode. A stand-in that accepted every
 * package would mark filings as handed over to an agent that never received
 * them -- the same class of confusion Phase C-0 spent its time removing, with a
 * statutory deadline attached.
 */
export function createHandoffDestinationForProviderMode(
  providerMode: ProviderMode,
  options: { config?: HandoffDestinationConfig | null; fetchImpl?: typeof fetch } = {},
): HandoffDestination | null {
  if (providerMode !== "live") return null;
  if (!options.config) return null;
  return createLiveHandoffDestination({
    config: options.config,
    fetchImpl: options.fetchImpl,
  });
}
