import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
test("captures actual local demo browser timing and parser network boundaries", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const observed = {
      lcp: null as number | null,
      cls: 0,
      interactions: [] as { id: number; duration: number }[],
    };
    Object.assign(window, { auditPerformance: observed });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) observed.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput) observed.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const event = entry as PerformanceEntry & { interactionId: number };
        if (event.interactionId)
          observed.interactions.push({ id: event.interactionId, duration: event.duration });
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /Amy Chan/ }).click();
  await expect(page).toHaveURL(/\/today/);
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "今日工作", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { auditPerformance: { lcp: number | null } }).auditPerformance.lcp,
      ),
    )
    .not.toBeNull();
  await page.getByRole("link", { name: "瀏覽周年申報案件" }).click();
  await expect(page).toHaveURL(/\/annual-returns/);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const actual = await page.evaluate(() => {
    const observed = (
      window as unknown as {
        auditPerformance: {
          lcp: number | null;
          cls: number;
          interactions: { id: number; duration: number }[];
        };
      }
    ).auditPerformance;
    return {
      ...observed,
      resources: performance.getEntriesByType("resource").map((entry) => entry.name),
      navigation: performance.getEntriesByType("navigation").map((entry) => entry.toJSON()),
    };
  });
  expect(
    actual.resources.filter((url) => /pdfjs-dist|mammoth|pdf\.worker|doc-parser/.test(url)),
  ).toEqual([]);
  await writeFile(
    info.outputPath("browser-performance.json"),
    JSON.stringify(
      {
        environment:
          "LOCAL ONLY existing read-only demo; fresh Auth/core production journey NOT verified",
        at: new Date().toISOString(),
        viewport: info.project.use.viewport,
        lcpMs: actual.lcp,
        inpCandidateMs: actual.interactions.length
          ? Math.max(...actual.interactions.map((x) => x.duration))
          : null,
        inpLimitation:
          "Observed Event Timing candidate from few interactions; no reported entries means unmeasured, never zero or production acceptance",
        ...actual,
      },
      null,
      2,
    ) + "\n",
  );
});
