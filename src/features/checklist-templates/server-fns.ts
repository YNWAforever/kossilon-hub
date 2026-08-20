import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ChecklistTemplateRepository } from "./repository";
import { SERVICE_TYPES, type ChecklistTemplatePatch, type ServiceType } from "./types";

export function assertAdminAccess(actor: AuthenticatedActor): void {
  if (!actor.active || actor.role !== "Admin") {
    throw new Error("Forbidden: Admin access is required.");
  }
}

export type ChecklistTemplateDependencies = {
  repository: ChecklistTemplateRepository;
};

export async function listChecklistTemplatesForActor(
  actor: AuthenticatedActor,
  _input: Record<string, never>,
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  return dependencies.repository.listTemplates();
}

export async function createChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { serviceType: (typeof SERVICE_TYPES)[number] },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  return dependencies.repository.createTemplate(input.serviceType);
}

export async function updateChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string; patch: ChecklistTemplatePatch },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  const updated = await dependencies.repository.updateTemplate(input.id, input.patch);
  if (!updated) throw new Error("Checklist template not found.");
  return updated;
}

export async function duplicateChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  const duplicated = await dependencies.repository.duplicateTemplate(input.id);
  if (!duplicated) throw new Error("Checklist template not found.");
  return duplicated;
}

export async function deleteChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  await dependencies.repository.deleteTemplate(input.id);
  return { deleted: true };
}

const ANNUAL_RETURN_SERVICE_TYPES: readonly ServiceType[] = [
  "Annual Return — Private Ltd",
  "Annual Return — Public Ltd",
];

export type ActiveChecklistTemplateSummary = {
  id: string;
  name: string;
  serviceType: ServiceType;
};

/**
 * Staff-readable, not Admin-only like every other function in this file: a
 * Manager/Staff actor creating an annual return case needs to pick a template
 * by name, but has no business editing template configuration — hence the
 * trimmed projection rather than reusing listChecklistTemplatesForActor.
 */
export async function listActiveAnnualReturnTemplatesForActor(
  actor: AuthenticatedActor,
  _input: Record<string, never>,
  dependencies: ChecklistTemplateDependencies,
): Promise<ActiveChecklistTemplateSummary[]> {
  assertStaffAccess(actor);
  const templates = await dependencies.repository.listTemplates();
  return templates
    .filter(
      (template) => template.active && ANNUAL_RETURN_SERVICE_TYPES.includes(template.serviceType),
    )
    .map((template) => ({
      id: template.id,
      name: template.name,
      serviceType: template.serviceType,
    }));
}

const loadDefaultChecklistTemplateContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createChecklistTemplateRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  const actor = await requireStaffActor(getRequest());
  return {
    actor,
    dependencies: {
      repository: createChecklistTemplateRepository(),
    } satisfies ChecklistTemplateDependencies,
  };
});

async function withDefaultChecklistTemplateContext<T>(
  handler: (actor: AuthenticatedActor, dependencies: ChecklistTemplateDependencies) => Promise<T>,
): Promise<T> {
  const { actor, dependencies } = await loadDefaultChecklistTemplateContext();
  try {
    return await handler(actor, dependencies);
  } finally {
    await dependencies.repository.close();
  }
}

const documentItemSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
    daysBeforeDue: z.number().int().min(0),
    note: z.string().optional(),
  })
  .strict();

const reminderRuleSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    daysBeforeDue: z.number().int().min(0),
    channel: z.enum(["WhatsApp", "Email", "SMS"]),
  })
  .strict();

const riskRuleSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    severity: z.enum(["Low", "Medium", "High"]),
    trigger: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

const serviceTypeSchema = z.enum(SERVICE_TYPES);

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    serviceType: serviceTypeSchema.optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
    documents: z.array(documentItemSchema).optional(),
    reminders: z.array(reminderRuleSchema).optional(),
    riskRules: z.array(riskRuleSchema).optional(),
  })
  .strict();

export const listChecklistTemplates = createServerFn({ method: "GET" }).handler(() =>
  withDefaultChecklistTemplateContext((actor, dependencies) =>
    listChecklistTemplatesForActor(actor, {}, dependencies),
  ),
);

export const listActiveAnnualReturnTemplates = createServerFn({ method: "GET" }).handler(() =>
  withDefaultChecklistTemplateContext((actor, dependencies) =>
    listActiveAnnualReturnTemplatesForActor(actor, {}, dependencies),
  ),
);

export const createChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ serviceType: serviceTypeSchema }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      createChecklistTemplateForActor(actor, { serviceType: data.serviceType }, dependencies),
    ),
  );

export const updateChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), patch: patchSchema }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      updateChecklistTemplateForActor(actor, { id: data.id, patch: data.patch }, dependencies),
    ),
  );

export const duplicateChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      duplicateChecklistTemplateForActor(actor, { id: data.id }, dependencies),
    ),
  );

export const deleteChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      deleteChecklistTemplateForActor(actor, { id: data.id }, dependencies),
    ),
  );
