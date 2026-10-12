import fs from "node:fs";
import { createSqlClient } from "../../src/server/db/client";
import { createWorkItemRepository } from "../../src/features/work-items/repository";
import { createAnnualReturnRepository } from "../../src/features/annual-return/repository";
import { createDocumentRepository } from "../../src/features/documents/repository";
import { createPaymentWorkspaceRepository } from "../../src/features/annual-return/payment-workspace-repository";
import { createWhatsAppHistoryRepository } from "../../src/features/whatsapp/history-repository";
import { createDailyWorkRepository } from "../../src/features/daily-work/repository";
import { createCompanyWorkspaceRepository } from "../../src/features/clients/company-workspace";
import { readIncorporationPage } from "../../src/features/incorporation/list-page-repository";
import { readCorporateChangePage } from "../../src/features/corporate-changes/list-page-repository";
import { observeCompanyWorkspace } from "./restored-company-evidence";
const url = process.env.R25_LOCAL_URL!;
if (new URL(url).hostname !== "127.0.0.1")
  throw Error("This rehearsal permits only the owned localhost restore.");
const sql = createSqlClient(url, { ssl: false, max: 1 });
try {
  const receipt = await sql.begin(async (tx) => {
    await tx.unsafe("set transaction read only");
    await tx.unsafe("set local statement_timeout='15s'");
    await tx.unsafe("set local lock_timeout='5s'");
    const queue = await createWorkItemRepository({ sql: tx }).listQueuePage({ limit: 50 });
    const cases = await createAnnualReturnRepository({ sql: tx }).listCasePage({ limit: 50 });
    const documents = await createDocumentRepository({ sql: tx }).listDocumentPage({ limit: 50 });
    const [user] =
      await tx`select id,team_id from users where active and role='Admin' order by id limit 1`;
    if (!user)
      throw Error(
        "BLOCKED: an existing active Admin SQL row is required for this read-only compatibility rehearsal.",
      );
    const actor = {
      userId: user.id,
      authUserId: "sql-compatibility-only-not-session",
      role: "Admin" as const,
      teamId: user.team_id as string | null,
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
    const dailyWork = await createDailyWorkRepository({ sql: tx }).listPage(actor, {
      scope: "team",
      limit: 50,
    });
    if (dailyWork.partial)
      throw Error("BLOCKED: a current daily-work source is unavailable on the restored schema.");
    const incorporation = await readIncorporationPage(
      tx,
      { kind: "all" },
      { limit: 50 },
      actor.userId,
    );
    const corporateChanges = await readCorporateChangePage(
      tx,
      { kind: "all" },
      { limit: 50 },
      actor.userId,
    );
    const [company] = await tx`select id from companies order by id limit 1`;
    const companyWorkspace = {
      observed: false,
      tabs: [] as string[],
      openCases: null as number | null,
      documents: null as number | null,
      paymentCases: null as number | null,
      activityRows: null as number | null,
    };
    if (company) {
      const repository = createCompanyWorkspaceRepository({ sql: tx });
      const data = { companyId: company.id as string, limit: 50 };
      Object.assign(
        companyWorkspace,
        await observeCompanyWorkspace({
          summary: () => repository.summary(actor, data),
          cases: () => repository.cases(actor, data),
          documents: () => repository.documents(actor, data),
          payments: () => repository.payments(actor, data),
          activity: () => repository.activity(actor, data),
        }),
      );
    }
    return {
      transaction: "READ ONLY",
      actorEvidence:
        "Admin DTO derived from an existing current SQL role/team; not an authenticated session or cross-role acceptance",
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
      dailyWork: {
        loaded: dailyWork.items.length,
        total: dailyWork.total,
        sources: dailyWork.sources,
        partial: dailyWork.partial,
      },
      incorporation: { loaded: incorporation.items.length, total: incorporation.total },
      corporateChanges: { loaded: corporateChanges.items.length, total: corporateChanges.total },
      companyWorkspace,
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
