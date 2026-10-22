import { createServerFn } from "@tanstack/react-start";
import { otherWorkPageForActor, otherWorkPageInput, otherWorkScope } from "./work-views-other-page";
import { toHongKongBusinessDate } from "@/lib/hong-kong-time";

export const getOtherBusinessWorkPage = createServerFn({ method: "GET" })
  .validator(otherWorkPageInput)
  .handler(async ({ data }) => {
    const [{ getRequest }, { requireStaffActor }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
    ]);
    const actor = await requireStaffActor(getRequest());
    otherWorkScope(actor);
    // Authorization precedes importing/creating any real client. Unit tests inject a read stub.
    const [{ getSqlClient }, { createOtherWorkReadRepository }] = await Promise.all([
      import("@/server/db/client"),
      import("./work-views-other-repository"),
    ]);
    return otherWorkPageForActor(
      actor,
      data,
      createOtherWorkReadRepository(getSqlClient()),
      toHongKongBusinessDate(new Date()),
    );
  });
