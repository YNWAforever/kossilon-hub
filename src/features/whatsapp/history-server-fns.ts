import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { historyConversationsInput, historyMessagesInput } from "./history-page";
const context = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { requireStaffActor },
    { getSqlClient },
    { createWhatsAppHistoryRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("@/server/db/client"),
    import("./history-repository"),
  ]);
  const actor = await requireStaffActor(getRequest());
  return { actor, repository: createWhatsAppHistoryRepository(getSqlClient()) };
});
export const listWhatsAppConversationPage = createServerFn({ method: "GET" })
  .validator(historyConversationsInput)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.conversations(actor, data);
  });
export const listWhatsAppMessagePage = createServerFn({ method: "GET" })
  .validator(historyMessagesInput)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.messages(actor, data);
  });
