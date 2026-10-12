import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { dailyWorkInputSchema, type DailyWorkInput } from "./types";
const load = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createDailyWorkRepository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);
  return { getRequest, requireStaffActor, createDailyWorkRepository };
});
export const listDailyWorkPage = createServerFn({ method: "GET" })
  .validator((input: DailyWorkInput) => dailyWorkInputSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor, createDailyWorkRepository } = await load();
    return createDailyWorkRepository().listPage(await requireStaffActor(getRequest()), data);
  });
export const getDailyAnnualReturnMetrics = createServerFn({ method: "GET" })
  .validator((input: Pick<DailyWorkInput, "q" | "scope" | "companyId">) =>
    dailyWorkInputSchema.parse({ ...input, sourceType: "annual_return" }),
  )
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor, createDailyWorkRepository } = await load();
    return createDailyWorkRepository().metrics(await requireStaffActor(getRequest()), data);
  });
