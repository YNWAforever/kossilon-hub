import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DB_INTEGRATION_TEST_FILES } from "./db-integration-files";

/**
 * A teardown list that stops short of the fixtures the file creates.
 *
 * `annual-return/repository.test.ts` declared `TEST_FIXTURE_SEQUENCES` as 1-32
 * and went on creating fixtures at 41-46. Teardown deleted by that list, so six
 * companies -- with their cases, documents, payments and two `pending` WhatsApp
 * reminders -- survived every run.
 *
 * Nothing failed at the time, which is why it lasted. The leak only bites the
 * NEXT run: the fixture insert names its ids deterministically and has no
 * `on conflict`, so a second run against the same database dies on
 * `companies_pkey`. CI builds an empty Postgres and runs once, so no CI run can
 * ever observe it; locally it cost three container rebuilds before the cause was
 * found.
 *
 * This compares the declared list against the sequences the file actually uses,
 * by reading the source. Files that derive their teardown from id prefixes
 * instead -- as annual-return now does -- have nothing to drift and declare no
 * list.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const SEQUENCE_LIST = /const TEST_FIXTURE_SEQUENCES = \[([\s\S]*?)\]/;
const SEQUENCE_USE = /\bsequence:\s*(\d+)/g;

function declaredSequences(source: string): number[] | null {
  const match = SEQUENCE_LIST.exec(source);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(Number);
}

function usedSequences(source: string): number[] {
  return [...source.matchAll(SEQUENCE_USE)].map((match) => Number(match[1]));
}

describe("fixture teardown covers every fixture created", () => {
  const withLists = DB_INTEGRATION_TEST_FILES.map((file) => ({
    file,
    source: readFileSync(join(REPO_ROOT, file), "utf8"),
  }))
    .map((entry) => ({ ...entry, declared: declaredSequences(entry.source) }))
    .filter((entry): entry is typeof entry & { declared: number[] } => entry.declared !== null);

  /**
   * Without this the suite goes quiet the moment the last list is removed, and a
   * test that checks nothing reads exactly like a test that passed.
   */
  it("still has a file to check", () => {
    expect(withLists.length).toBeGreaterThan(0);
  });

  // Registered in a loop rather than with `it.each`, which throws at collection
  // time on an empty list -- taking the whole file down with it and hiding the
  // plain sentence above behind a collection error.
  for (const { file, declared, source } of withLists) {
    it(`${file} cleans up every sequence it creates`, () => {
      const uncovered = [...new Set(usedSequences(source))]
        .filter((sequence) => !declared.includes(sequence))
        .sort((left, right) => left - right);

      expect(uncovered).toEqual([]);
    });
  }
});
