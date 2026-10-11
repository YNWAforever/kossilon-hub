import fs from "node:fs";
import { createSqlClient } from "../../src/server/db/client";
import { createWorkItemRepository } from "../../src/features/work-items/repository";
import { createAnnualReturnRepository } from "../../src/features/annual-return/repository";
import { createDocumentRepository } from "../../src/features/documents/repository";
import { createPaymentWorkspaceRepository } from "../../src/features/annual-return/payment-workspace-repository";
import { createWhatsAppHistoryRepository } from "../../src/features/whatsapp/history-repository";
const url = process.env.R25_LOCAL_URL!;
if (new URL(url).hostname !== "127.0.0.1")
  throw Error("This rehearsal permits only the owned localhost restore.");
const sql = createSqlClient(url, { ssl: false, max: 1 });
try {
  const receipt = await sql.begin(async (tx) => {
    await tx.unsafe("set transaction read only");
    const queue = await createWorkItemRepository({ sql: tx }).listQueuePage({ limit: 50 });
    const cases = await createAnnualReturnRepository({ sql: tx }).listCasePage({ limit: 50 });
    const documents = await createDocumentRepository({ sql: tx }).listDocumentPage({ limit: 50 });
    const [user] = await tx`select id from users where active limit 1`;
    const actor = {
      userId: user.id,
      authUserId: "local-readonly-DTO-not-auth-session",
      role: "Admin" as const,
      teamId: null,
      active: true,
    };
    const paymentRepo = createPaymentWorkspaceRepository(tx);
    const review = await paymentRepo.list(actor, { mode: "review" }),
      outstanding = await paymentRepo.list(actor, { mode: "outstanding" });
    const historyRepo = createWhatsAppHistoryRepository(tx);
    const threads = await historyRepo.conversations(actor, {});
    const messages = await historyRepo.messages(actor, {
      contactId: threads.items[0]?.contactId ?? "00000000-0000-4000-8000-000000000001",
    });
    const facets = await createWorkItemRepository({ sql: tx }).listQueueFilterOptions(
      {},
      { kind: "owner" },
    );
    return {
      transaction: "READ ONLY",
      actorEvidence:
        "synthetic Admin DTO for local SQL compatibility only, no authenticated session",
      queue: {
        loaded: queue.items.length,
        total: queue.total,
        nullableSla: queue.items.filter((i) => !i.slaDueAt).length,
        ownerOptions: facets.items.length,
      },
      cases: { loaded: cases.cases.length },
      documents: { loaded: documents.documents.length, total: documents.total },
      paymentReview: { loaded: review.items.length, total: review.total },
      outstanding: { loaded: outstanding.items.length, total: outstanding.total },
      history: {
        threadsLoaded: threads.items.length,
        threadsTotal: threads.total,
        messagesLoaded: messages?.items.length ?? 0,
        messagesTotal: messages?.total ?? 0,
      },
      sideEffects: 0,
    };
  });
  fs.writeFileSync(
    process.argv[2] ?? ".worktrees/staff-batch2-20261012/restored-runtime-read.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(receipt);
} finally {
  await sql.end();
}
