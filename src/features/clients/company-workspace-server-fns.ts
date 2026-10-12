import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { companyWorkspaceInput } from "./company-workspace-types";
const load = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createCompanyWorkspaceRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./company-workspace"),
    ]);
  return { getRequest, requireStaffActor, createCompanyWorkspaceRepository };
});
export const getCompanyWorkspaceSummary = createServerFn({ method: "GET" })
  .validator(companyWorkspaceInput.pick({ companyId: true }))
  .handler(async ({ data }) => {
    const d = await load();
    return d
      .createCompanyWorkspaceRepository()
      .summary(await d.requireStaffActor(d.getRequest()), data);
  });
export const listCompanyWorkspaceCases = createServerFn({ method: "GET" })
  .validator(companyWorkspaceInput)
  .handler(async ({ data }) => {
    const d = await load();
    return d
      .createCompanyWorkspaceRepository()
      .cases(await d.requireStaffActor(d.getRequest()), data);
  });
export const listCompanyWorkspaceDocuments = createServerFn({ method: "GET" })
  .validator(companyWorkspaceInput)
  .handler(async ({ data }) => {
    const d = await load();
    return d
      .createCompanyWorkspaceRepository()
      .documents(await d.requireStaffActor(d.getRequest()), data);
  });
export const listCompanyWorkspacePayments = createServerFn({ method: "GET" })
  .validator(companyWorkspaceInput)
  .handler(async ({ data }) => {
    const d = await load();
    return d
      .createCompanyWorkspaceRepository()
      .payments(await d.requireStaffActor(d.getRequest()), data);
  });
export const listCompanyWorkspaceActivity = createServerFn({ method: "GET" })
  .validator(companyWorkspaceInput)
  .handler(async ({ data }) => {
    const d = await load();
    return d
      .createCompanyWorkspaceRepository()
      .activity(await d.requireStaffActor(d.getRequest()), data);
  });
