import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";

const loadCompanyWorkContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { getSqlClient }, { readCompanyWorkPage }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("@/server/db/client"),
      import("./company-work"),
    ]);
  return { getRequest, requireStaffActor, getSqlClient, readCompanyWorkPage };
});

export const listCompanyWorkPage = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        companyId: z.string().guid(),
        cursor: z.string().max(2048).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor, getSqlClient, readCompanyWorkPage } =
      await loadCompanyWorkContext();
    const actor = await requireStaffActor(getRequest());
    return readCompanyWorkPage(getSqlClient(), actor, data);
  });
