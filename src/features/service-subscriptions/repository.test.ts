import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createServiceSubscriptionRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for service subscription integration tests.");
  }
  return createSqlClient(databaseUrl, { max: 1 });
}

describe.skipIf(!databaseUrl)("service subscriptions integration", () => {
  it("adds a subscription with the given fee and renewal date", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2800,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          expect(created.status).toBe("Active");
          expect(created.fee).toBe(2800);
          expect(created.renewalDate).toBe("2027-01-01");
          expect(created.cancelledAt).toBeNull();

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("rejects adding a second active subscription for the same service type", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          await repository.addSubscription({
            companyId: company.id,
            serviceType: "registered_office",
            fee: 2800,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          await expect(
            repository.addSubscription({
              companyId: company.id,
              serviceType: "registered_office",
              fee: 2800,
              renewalDate: "2027-06-01",
              actorId: owner.id,
            }),
          ).rejects.toThrow("This company already has an active subscription for that service.");

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("renews by advancing exactly one year from the current renewal date", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "director_correspondence_address",
            fee: 1000,
            renewalDate: "2026-08-01",
            actorId: owner.id,
          });

          const renewed = await repository.renewSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          });

          expect(renewed.renewalDate).toBe("2027-08-01");

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("cancels a subscription and rejects renewing or cancelling it again", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "designated_representative",
            fee: 2000,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          const cancelled = await repository.cancelSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          });

          expect(cancelled.status).toBe("Cancelled");
          expect(cancelled.cancelledAt).not.toBeNull();

          await expect(
            repository.cancelSubscription({
              subscriptionId: created.id,
              companyId: company.id,
              actorId: owner.id,
            }),
          ).rejects.toThrow("Cannot cancel a subscription that is not Active.");

          await expect(
            repository.renewSubscription({
              subscriptionId: created.id,
              companyId: company.id,
              actorId: owner.id,
            }),
          ).rejects.toThrow("Cannot renew a subscription that is not Active.");

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("reactivates a cancelled subscription in place rather than inserting a second row", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2800,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          await repository.cancelSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          });

          const reactivated = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2900,
            renewalDate: "2028-01-01",
            actorId: owner.id,
          });

          expect(reactivated.id).toBe(created.id);
          expect(reactivated.status).toBe("Active");
          expect(reactivated.fee).toBe(2900);
          expect(reactivated.renewalDate).toBe("2028-01-01");
          expect(reactivated.cancelledAt).toBeNull();

          const all = await repository.listSubscriptions(company.id);
          expect(all.filter((row) => row.serviceType === "secretary")).toHaveLength(1);

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("serializes concurrent cancellations so exactly one succeeds", async () => {
    const setupSql = sqlForTests();
    let subscriptionId: string | undefined;

    try {
      const repository = createServiceSubscriptionRepository({ sql: setupSql });
      const [company] = await setupSql<{ id: string }[]>`select id from companies limit 1`;
      const [owner] = await setupSql<{ id: string }[]>`select id from users where active limit 1`;

      const created = await repository.addSubscription({
        companyId: company.id,
        serviceType: "secretary",
        fee: 2800,
        renewalDate: "2027-01-01",
        actorId: owner.id,
      });
      subscriptionId = created.id;

      // Two independent connections racing to cancel the SAME subscription
      // concurrently — this is what actually exercises the `for update` lock
      // added to cancelSubscription/renewSubscription. A single shared
      // transaction calling cancelSubscription twice sequentially would never
      // race at all, since there is nothing to serialize against — the same
      // tautological-test mistake documented in incorporation's "serializes
      // concurrent completions" test (P1-5's first attempt at the
      // secretary-appointment race test).
      const sqlA = createSqlClient(databaseUrl!, { max: 1 });
      const sqlB = createSqlClient(databaseUrl!, { max: 1 });

      let results: PromiseSettledResult<unknown>[];
      try {
        results = await Promise.allSettled([
          createServiceSubscriptionRepository({ sql: sqlA }).cancelSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          }),
          createServiceSubscriptionRepository({ sql: sqlB }).cancelSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          }),
        ]);
      } finally {
        await sqlA.end();
        await sqlB.end();
      }

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<unknown> => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      // Exactly one call wins and cancels the row; the other loses the race
      // (blocked by the `for update` lock, then sees the already-committed
      // 'Cancelled' status and throws) rather than both succeeding.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(Error);
      expect((rejected[0].reason as Error).message).toContain(
        "Cannot cancel a subscription that is not Active.",
      );

      const final = await repository.listSubscriptions(company.id);
      const finalRow = final.find((row) => row.id === created.id);
      expect(finalRow?.status).toBe("Cancelled");
    } finally {
      if (subscriptionId) {
        await setupSql`delete from service_subscriptions where id = ${subscriptionId}`;
      }
      await setupSql.end();
    }
  });
});
