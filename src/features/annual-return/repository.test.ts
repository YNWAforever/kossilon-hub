import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import { createAnnualReturnRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const USER_AMY_ID = "20000000-0000-0000-0000-000000000001";
const USER_KEN_ID = "20000000-0000-0000-0000-000000000002";
const USER_MEI_ID = "20000000-0000-0000-0000-000000000003";
const USER_PRIYA_ID = "20000000-0000-0000-0000-000000000004";
const TEAM_ANNUAL_RETURN_ID = "10000000-0000-0000-0000-000000000001";
const TEAM_EVIDENCE_ID = "10000000-0000-0000-0000-000000000002";

type ClosableRepository = ReturnType<typeof createAnnualReturnRepository>;

const repositories: ClosableRepository[] = [];

function repositoryFor(today = "2026-07-05"): ClosableRepository {
  const repository = createAnnualReturnRepository(databaseUrl!, { today });
  repositories.push(repository);
  return repository;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
});

describe.skipIf(!databaseUrl)("annual return repository", () => {
  it("lists annual return cases with company, owner, reviewer, checklist, payment, and recalculated risk", async () => {
    const repository = repositoryFor("2026-07-05");

    const cases = await repository.listCases({});

    expect(cases.map((case_) => case_.companyName)).toEqual([
      "Victoria Peak Holdings Ltd",
      "Kowloon Textiles Ltd",
      "Harbour Trading Ltd",
    ]);

    const harbour = cases.find((case_) => case_.companyName === "Harbour Trading Ltd");
    expect(harbour).toMatchObject({
      currentStatus: "Documents pending",
      ownerId: USER_MEI_ID,
      ownerName: "Mei Lam",
      reviewerId: USER_KEN_ID,
      reviewerName: "Ken Wong",
      filingDueDate: "2026-08-12",
      riskLevel: "green",
    });
    expect(harbour?.checklist).toHaveLength(5);
    expect(harbour?.payment).toMatchObject({
      invoiceNumber: "KOS-AR-2026-1200001",
      amount: 3800,
      currency: "HKD",
      status: "Payment pending",
      dueDate: "2026-08-05",
    });

    const kowloon = cases.find((case_) => case_.companyName === "Kowloon Textiles Ltd");
    expect(kowloon?.riskLevel).toBe("yellow");

    const victoria = cases.find((case_) => case_.companyName === "Victoria Peak Holdings Ltd");
    expect(victoria?.riskLevel).toBe("green");
  });

  it("returns one hydrated case by id and null for an unknown case", async () => {
    const repository = repositoryFor("2026-07-05");
    const [firstCase] = await repository.listCases({ status: "Documents pending" });

    const case_ = await repository.getCase(firstCase.id);

    expect(case_).toMatchObject({
      id: firstCase.id,
      companyName: "Harbour Trading Ltd",
      currentStatus: "Documents pending",
    });
    expect(case_?.checklist).toHaveLength(5);
    expect(case_?.payment?.invoiceNumber).toBe("KOS-AR-2026-1200001");
    await expect(repository.getCase("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("filters cases by owner, team, reviewer, status, payment, risk, and missing documents", async () => {
    const repository = repositoryFor("2026-07-05");

    await expect(repository.listCases({ ownerId: USER_MEI_ID })).resolves.toHaveLength(1);
    await expect(repository.listCases({ teamId: TEAM_ANNUAL_RETURN_ID })).resolves.toHaveLength(2);
    await expect(repository.listCases({ teamId: TEAM_EVIDENCE_ID })).resolves.toHaveLength(1);
    await expect(repository.listCases({ reviewerId: USER_KEN_ID })).resolves.toHaveLength(3);
    await expect(repository.listCases({ status: "Filed" })).resolves.toHaveLength(1);
    await expect(repository.listCases({ paymentStatus: "Payment pending" })).resolves.toHaveLength(
      2,
    );

    const riskyCases = await repository.listCases({ risk: "yellow" });
    expect(riskyCases.map((case_) => case_.companyName)).toEqual(["Kowloon Textiles Ltd"]);

    const casesMissingDocuments = await repository.listCases({ missingDocuments: true });
    expect(casesMissingDocuments.map((case_) => case_.companyName)).toEqual([
      "Harbour Trading Ltd",
    ]);

    const casesWithoutMissingDocuments = await repository.listCases({ missingDocuments: false });
    expect(casesWithoutMissingDocuments.map((case_) => case_.companyName)).toEqual([
      "Victoria Peak Holdings Ltd",
      "Kowloon Textiles Ltd",
    ]);
  });

  it("uses the repository date source for overdue-only reads", async () => {
    const julyFiveRepository = repositoryFor("2026-07-05");
    const julyTwentyEightRepository = repositoryFor("2026-07-28");

    await expect(julyFiveRepository.listCases({ overdueOnly: true })).resolves.toHaveLength(1);

    const overdueCases = await julyTwentyEightRepository.listCases({ overdueOnly: true });
    expect(overdueCases.map((case_) => case_.companyName)).toEqual([
      "Victoria Peak Holdings Ltd",
      "Kowloon Textiles Ltd",
    ]);
  });

  it("returns dashboard metrics for active operational work", async () => {
    const repository = repositoryFor("2026-07-05");

    await expect(repository.dashboardMetrics("2026-07-05", USER_AMY_ID)).resolves.toEqual({
      dueIn7: 0,
      dueIn30: 1,
      overdue: 0,
      highRisk: 0,
      missingDocuments: 3,
      paymentPending: 2,
      assignedToMe: 1,
    });

    await expect(repository.dashboardMetrics("2026-07-05", USER_PRIYA_ID)).resolves.toMatchObject({
      assignedToMe: 1,
    });
  });
});
