import { expect, test } from "@playwright/test";
import postgres from "postgres";

/**
 * End-to-end proof for the applied request-access migration:
 * fill the real public form -> server function -> Postgres row -> cleanup.
 *
 * Runs only when DATABASE_URL is present (CI applies migrations first). The
 * local demo page is public, but the server function writes to the real database.
 */
test("persists a public request and can be reviewed", async ({ page }, info) => {
  const databaseUrl = process.env.DATABASE_URL;
  test.skip(!databaseUrl, "requires the CI database (DATABASE_URL)");
  const email = `e2e-request-${info.project.name}-${Date.now()}@example.test`;
  const ssl = process.env.DATABASE_SSL === "disable" ? false : "require";
  const sql = postgres(databaseUrl!, { ssl, max: 1, connect_timeout: 15 });

  page.on("response", (response) => {
    if (response.url().includes("/_serverFn") && response.status() >= 400)
      console.log("server-fn response", response.status(), response.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.log("browser console error", message.text());
  });

  try {
    await page.goto("/request-access", { waitUntil: "networkidle" });
    // The form is server-rendered; give React time to attach the submit handler
    // before typing (a native submit would reload the page and lose the success state).
    await page.waitForTimeout(1000);
    await page.locator("#request-access-name").fill("E2E Request");
    await page.locator("#request-access-email").fill(email);
    await page.locator("#request-access-firm").fill("E2E Firm Limited");
    await page.locator("#request-access-team").fill("E2E Team");
    await page.locator("#request-access-message").fill("Created by the browser persistence test.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "送出申請" }).click();

    await expect(page.getByText("已收到申請")).toBeVisible();

    const rows = await sql<
      { name: string; email: string; firm: string; team: string | null; status: string }[]
    >`select name, email, firm, team, status from request_access_requests where email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "E2E Request",
      email,
      firm: "E2E Firm Limited",
      team: "E2E Team",
      status: "pending",
    });
  } finally {
    await sql`delete from request_access_requests where email = ${email}`;
    await sql.end({ timeout: 5 });
  }
});
