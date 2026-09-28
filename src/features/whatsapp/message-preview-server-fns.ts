import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import { prepareMessageForActor, queueApprovedMessageForActor } from "./message-preview";

export const prepareMessageInputSchema = z
  .object({
    caseId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    contactId: z.string().uuid(),
    purpose: z.enum(["reply", "reminder"]),
    draft: z.string().min(1).max(4096),
  })
  .strict();

export const queueApprovedMessageInputSchema = z
  .object({
    previewId: z.string().uuid(),
    previewHash: z.string().regex(/^[0-9a-f]{64}$/),
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();

async function assertPreviewRuntime(
  actor: Awaited<ReturnType<typeof loadContext>>["actor"],
  sending: boolean,
) {
  const [{ currentProviderMode }, { getWhatsAppIntegrationStatusForActor }] = await Promise.all([
    import("@/server/provider-mode"),
    import("./server-fns"),
  ]);
  const mode = currentProviderMode();
  if (mode !== "live") throw new Error("Demo messaging is read-only.");
  if (sending) {
    const state = getWhatsAppIntegrationStatusForActor(actor, process.env, mode);
    if (state.capabilityStatus.state !== "healthy") {
      throw new Error(
        "WhatsApp provider is unverified. Queueing requires current provider evidence.",
      );
    }
  }
}

const loadContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createMessagePreviewRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./message-preview-repository"),
    ]);
  const actor = assertStaffAccess(await requireStaffActor(getRequest()));
  if (!actor.userId) throw new Error("A staff database identity is required.");
  return { actor, repository: createMessagePreviewRepository() };
});

export const prepareMessage = createServerFn({ method: "POST" })
  .validator(prepareMessageInputSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await loadContext();
    await assertPreviewRuntime(actor, false);
    return prepareMessageForActor(actor, data, { now: () => new Date(), repository });
  });

export const queueApprovedMessage = createServerFn({ method: "POST" })
  .validator(queueApprovedMessageInputSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await loadContext();
    await assertPreviewRuntime(actor, true);
    return queueApprovedMessageForActor(actor, data, { now: () => new Date(), repository });
  });

export const listReplyTargetsInputSchema = z
  .object({
    conversationId: z.string().uuid(),
  })
  .strict();

export const listReplyTargets = createServerFn({ method: "GET" })
  .validator(listReplyTargetsInputSchema)
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { requireStaffActor },
      { getSqlClient },
      { getAnnualReturnActionPermission },
    ] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("@/server/db/client"),
      import("@/features/annual-return/permissions"),
    ]);
    const staff = assertStaffAccess(await requireStaffActor(getRequest()));
    if (!staff.userId) throw new Error("A staff database identity is required.");
    const sql = getSqlClient();
    const rows = await sql<
      {
        case_id: string;
        company_id: string;
        company_name: string;
        assigned_team_id: string;
        owner_id: string;
        reviewer_id: string | null;
        current_status: string;
        contact_id: string;
        contact_name: string;
        contact_role: string;
        phone_e164: string | null;
        phone_verified_at: string | null;
        preferred_language: string | null;
      }[]
    >`
      select arc.id as case_id, c.id as company_id, c.company_name, c.assigned_team_id,
        arc.owner_id, arc.reviewer_id, arc.current_status,
        cc.id as contact_id, cc.name as contact_name, cc.role as contact_role,
        cc.phone_e164, cc.phone_verified_at::text as phone_verified_at,
        cc.preferred_language
      from whatsapp_contacts wc
      join company_contacts cc
        on regexp_replace(coalesce(cc.phone,''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(wc.phone_e164,''), '[^0-9]', '', 'g')
      join companies c on c.id = cc.company_id and c.data_origin = 'client'
      join annual_return_cases arc on arc.company_id = c.id
        and arc.current_status not in ('Filed','Completed')
      where wc.id = ${data.conversationId}
        and wc.phone_e164 is not null
      order by c.company_name, arc.return_year desc, cc.name
      limit 100
    `;
    return rows
      .filter(
        (row) =>
          getAnnualReturnActionPermission(
            {
              id: staff.userId!,
              role: staff.role as "Admin" | "Manager" | "Staff",
              teamId: staff.teamId,
              active: staff.active,
            },
            {
              id: row.case_id,
              companyName: row.company_name,
              companyTeamId: row.assigned_team_id,
              ownerId: row.owner_id,
              reviewerId: row.reviewer_id,
            },
            "record_reminder",
          ).allowed,
      )
      .map((row) => ({
        caseId: row.case_id,
        companyId: row.company_id,
        companyName: row.company_name,
        contactId: row.contact_id,
        contactName: row.contact_name,
        contactRole: row.contact_role,
        verified: Boolean(row.phone_e164 && row.phone_verified_at && row.preferred_language),
        languageCode: row.preferred_language,
      }));
  });
