import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import { assertClientCompanyWritable } from "./authorization";
import { getSqlClient } from "@/server/db/client";

export const verifyContactPhoneSchema = z
  .object({
    companyId: z.string().uuid(),
    contactId: z.string().uuid(),
    phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
    preferredLanguage: z.enum(["en", "zh_HK"]),
    verificationEvidence: z.string().trim().min(8).max(500),
  })
  .strict();

export const verifyClientContactPhone = createServerFn({ method: "POST" })
  .validator(verifyContactPhoneSchema)
  .handler(async ({ data }) => {
    const [{ getRequest }, { requireStaffActor }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
    ]);
    const staff = assertStaffAccess(await requireStaffActor(getRequest()));
    if (!staff.userId) throw new Error("A staff database identity is required.");
    const sql = getSqlClient();
    return sql.begin(async (tx) => {
      const companies = await tx<
        {
          assigned_team_id: string;
          data_origin: string;
        }[]
      >`
        select assigned_team_id, data_origin from companies
        where id = ${data.companyId} for update
      `;
      const company = companies[0];
      if (!company) throw new Error("Client company not found.");
      assertClientCompanyWritable(staff, { assignedTeamId: company.assigned_team_id });
      if (company.data_origin !== "client")
        throw new Error("Fixture contacts cannot be verified for messaging.");
      const contacts = await tx<{ id: string; name: string; phone: string | null }[]>`
        select id, name, phone from company_contacts
        where id = ${data.contactId} and company_id = ${data.companyId}
        for update
      `;
      const contact = contacts[0];
      if (!contact) throw new Error("Contact not found for this client.");
      if (
        !contact.phone ||
        contact.phone.replace(/\D/g, "") !== data.phoneE164.replace(/\D/g, "")
      ) {
        throw new Error(
          "Verified E.164 number must match the saved contact phone. Edit the contact first.",
        );
      }
      await tx`
        update company_contacts
        set phone_e164 = ${data.phoneE164},
          phone_verified_at = now(),
          phone_verified_by = ${staff.userId},
          phone_verification_evidence = ${data.verificationEvidence},
          preferred_language = ${data.preferredLanguage},
          updated_at = now()
        where id = ${data.contactId} and company_id = ${data.companyId}
      `;
      await tx`
        insert into timeline_events (
          company_id, event_type, actor_type, actor_id, description, metadata
        ) values (
          ${data.companyId}, 'contact_phone_verified', 'user', ${staff.userId},
          ${"Confirmed messaging phone for " + contact.name + "."},
          ${tx.json({
            contactId: data.contactId,
            phoneLast4: data.phoneE164.slice(-4),
            preferredLanguage: data.preferredLanguage,
            verificationEvidence: data.verificationEvidence,
          })}
        )
      `;
      return { contactId: data.contactId, phoneLast4: data.phoneE164.slice(-4) };
    });
  });
