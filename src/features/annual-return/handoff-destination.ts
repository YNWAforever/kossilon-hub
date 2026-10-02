import { z } from "zod";
import type { ProviderMode } from "@/server/provider-mode";

/**
 * The filing agent's server.
 *
 * BLOCKED_INTEGRATION: external-handoff-destination. The destination is the
 * firm's internal server; its protocol, address, authentication and rights are
 * not known to this repository, and no binding for them is defined. So
 * `createHandoffDestinationForProviderMode` requires a separately verified port;
 * the current runtime provides none and nothing transmits.
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

const responseSchema = z
  .object({
    /** The destination's own identifier, quoted back to the agent in a query. */
    reference: z.string().min(1).max(200),
    accepted: z.boolean(),
    /** Their words when they refuse. Recorded, never parsed into a decision. */
    detail: z.string().max(2000).optional(),
  })
  .strict();

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
  | { status: "unknown"; retryable: false; errorCode: string }
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
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > HANDOFF_TIMEOUT_MS)
    throw new Error("Handoff timeout must be1..30000ms.");

  return {
    async submit(submission): Promise<HandoffResult> {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error("Handoff deadline"), { name: "AbortError" }));
        }, timeoutMs);
      });
      try {
        const result = await Promise.race([
          (async (): Promise<HandoffResult> => {
            const response = await fetchImpl(options.config.endpoint, {
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
            if (!response.ok)
              return {
                status: response.status >= 500 || response.status === 429 ? "unknown" : "failed",
                retryable: false,
                errorCode: `http-${response.status}`,
              };
            if (!response.body)
              return { status: "unknown", retryable: false, errorCode: "malformed-response" };
            reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 16384) {
                void reader.cancel().catch(() => {});
                return { status: "unknown", retryable: false, errorCode: "response-too-large" };
              }
              chunks.push(value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.length;
            }
            const parsed = responseSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
            if (!parsed.success)
              return { status: "unknown", retryable: false, errorCode: "malformed-response" };
            return parsed.data.accepted
              ? { status: "accepted", destinationReference: parsed.data.reference }
              : {
                  status: "refused",
                  destinationReference: parsed.data.reference,
                  detail: parsed.data.detail ?? null,
                };
          })(),
          timeout,
        ]);
        return result;
      } catch (error) {
        // By class, not by message: a transport error string can carry an
        // internal address or a token, and this is persisted.
        return {
          status: "unknown",
          retryable: false,
          errorCode:
            error instanceof Error && error.name === "AbortError"
              ? "timeout"
              : error instanceof SyntaxError
                ? "malformed-response"
                : "transport",
        };
      } finally {
        clearTimeout(timer!);
        controller.abort();
        void reader?.cancel().catch(() => {});
      }
    },
  };
}

/**
 * Disabled until the chosen protocol has an explicitly verified destination port.
 *
 * No fixture destination exists, in any mode. A stand-in that accepted every
 * package would mark filings as handed over to an agent that never received
 * them -- the same class of confusion Phase C-0 spent its time removing, with a
 * statutory deadline attached.
 */
export function createHandoffDestinationForProviderMode(
  providerMode: ProviderMode,
  options: {
    config?: HandoffDestinationConfig | null;
    fetchImpl?: typeof fetch;
    protocolVerified?: boolean;
    destination?: HandoffDestination;
  } = {},
): HandoffDestination | null {
  if (providerMode !== "live") return null;
  // A URL/key do not establish the unknown internal-server protocol. Only a
  // separately implemented and verified destination port may activate runtime.
  if (!options.protocolVerified || !options.destination) return null;
  return options.destination;
}
