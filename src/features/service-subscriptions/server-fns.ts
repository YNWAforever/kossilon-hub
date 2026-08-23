import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertServiceSubscriptionWritable } from "./authorization";
import type { ServiceSubscriptionRepository } from "./repository";
import { SERVICE_TYPES } from "./types";

const loadDefaultServiceSubscriptionContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createServiceSubscriptionRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  return { getRequest, requireStaffActor, createServiceSubscriptionRepository };
});

async function getCurrentServiceSubscriptionActor(): Promise<
  AuthenticatedActor & { userId: string }
> {
  const { getRequest, requireStaffActor } = await loadDefaultServiceSubscriptionContext();
  const actor = await requireStaffActor(getRequest());

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}

async function requireWritableCompany(
  repository: ServiceSubscriptionRepository,
  companyId: string,
): Promise<string> {
  const actor = await getCurrentServiceSubscriptionActor();
  const assignedTeamId = await repository.getCompanyTeamId(companyId);

  if (!assignedTeamId) {
    throw new Error("Company not found.");
  }

  assertServiceSubscriptionWritable(actor, { assignedTeamId });
  return actor.userId;
}

async function withServiceSubscriptionRepository<T>(
  handler: (repository: ServiceSubscriptionRepository) => Promise<T>,
): Promise<T> {
  const { createServiceSubscriptionRepository } = await loadDefaultServiceSubscriptionContext();
  const repository = createServiceSubscriptionRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

const listSubscriptionsSchema = z.object({ companyId: z.string().uuid() });

const addSubscriptionSchema = z.object({
  companyId: z.string().uuid(),
  serviceType: z.enum(SERVICE_TYPES),
  fee: z.number().int().positive(),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const renewSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  companyId: z.string().uuid(),
});

const cancelSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const listServiceSubscriptions = createServerFn({ method: "GET" })
  .validator(listSubscriptionsSchema)
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultServiceSubscriptionContext();
    await requireStaffActor(getRequest());
    return withServiceSubscriptionRepository((repository) =>
      repository.listSubscriptions(data.companyId),
    );
  });

export const addServiceSubscription = createServerFn({ method: "POST" })
  .validator(addSubscriptionSchema)
  .handler(async ({ data }) =>
    withServiceSubscriptionRepository(async (repository) =>
      repository.addSubscription({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const renewServiceSubscription = createServerFn({ method: "POST" })
  .validator(renewSubscriptionSchema)
  .handler(async ({ data }) =>
    withServiceSubscriptionRepository(async (repository) =>
      repository.renewSubscription({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const cancelServiceSubscription = createServerFn({ method: "POST" })
  .validator(cancelSubscriptionSchema)
  .handler(async ({ data }) =>
    withServiceSubscriptionRepository(async (repository) =>
      repository.cancelSubscription({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );
