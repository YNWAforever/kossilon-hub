import { z } from "zod";

export const requestAccessSubmissionSchema = z.object({
  name: z.string().trim().min(1, "name required").max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  firm: z.string().trim().min(1, "firm required").max(160),
  team: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  /** Explicit consent to store contact details for the review. */
  consent: z.literal(true, { message: "consent required" }),
  /** Honeypot: real users never see or fill this; a filled value is accepted and ignored. */
  website: z.string().max(500).optional().default(""),
});

export type RequestAccessSubmission = z.infer<typeof requestAccessSubmissionSchema>;

export type NormalizedRequestAccess = {
  name: string;
  email: string;
  firm: string;
  team: string | null;
  message: string | null;
  honeypot: boolean;
};

export type RequestAccessResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; code: "rate-limited" | "unavailable" | "error" };

export type RequestAccessStatus = "pending" | "approved" | "rejected";

export type RequestAccessQueueRow = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  firm: string;
  team: string | null;
  message: string | null;
  status: RequestAccessStatus;
};

export const requestAccessDecisionSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["approved", "rejected"]),
  })
  .strict();

export type RequestAccessDecision = z.infer<typeof requestAccessDecisionSchema>;

export function normalizeRequestAccess(input: RequestAccessSubmission): NormalizedRequestAccess {
  return {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    firm: input.firm.trim(),
    team: input.team?.trim() ? input.team.trim() : null,
    message: input.message?.trim() ? input.message.trim() : null,
    honeypot: Boolean(input.website?.trim()),
  };
}
