// R2 / Postgres pairing check. Read-only: HEADs the objects referenced by the
// current document rows and compares stored checksum/size metadata with the
// database. Never reads object bodies, lists the bucket or deletes anything.
//
// Requires DATABASE_URL (or DATABASE_URL_FILE) and R2 credentials. Credentials
// may come from R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME
// or a JSON file at %USERPROFILE%\.kossilon-r2.json (override with
// R2_CREDENTIALS_FILE). Never commit or log the values.
//
// Run: node --experimental-strip-types scripts/storage-pairing.ts [--write] [--limit=100]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

import { createR2S3Bucket } from "../src/server/r2-s3-bucket.ts";
import {
  summarizeStoragePairing,
  type ObjectInspection,
  type PairingDocument,
} from "./storage-pairing-lib.ts";

type Credentials = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
};

type Row = {
  storage_url: string;
  file_name: string;
  verified_checksum_sha256: string | null;
  declared_checksum_sha256: string | null;
  verified_byte_size: string | number | null;
  declared_byte_size: string | number | null;
};

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ".";
const CREDENTIALS_FILE = process.env.R2_CREDENTIALS_FILE ?? join(HOME, ".kossilon-r2.json");
const DATABASE_URL_FILE = process.env.DATABASE_URL_FILE ?? join(HOME, ".kossilon-database-url");

function parseArgs(argv: readonly string[]) {
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.slice("--limit=".length)) : 100;
  const limit =
    Number.isSafeInteger(parsedLimit) && parsedLimit > 0 && parsedLimit <= 500 ? parsedLimit : 100;
  return { write: argv.includes("--write"), limit };
}

function readDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(DATABASE_URL_FILE)) {
    const value = readFileSync(DATABASE_URL_FILE, "utf8").trim();
    if (value) return value;
  }
  throw new Error("DATABASE_URL is required (or save the URI at the DATABASE_URL_FILE path).");
}

function readCredentials(): Credentials {
  const fromEnv: Credentials = {
    accountId: process.env.R2_ACCOUNT_ID?.trim() ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
    bucketName: process.env.R2_BUCKET_NAME?.trim() ?? "",
  };
  let credentials = fromEnv;
  if (!Object.values(credentials).every(Boolean) && existsSync(CREDENTIALS_FILE)) {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8")) as Partial<Credentials>;
    credentials = {
      accountId: parsed.accountId?.trim() ?? "",
      accessKeyId: parsed.accessKeyId?.trim() ?? "",
      secretAccessKey: parsed.secretAccessKey?.trim() ?? "",
      bucketName: parsed.bucketName?.trim() ?? "",
    };
  }
  if (!Object.values(credentials).every(Boolean)) {
    throw new Error(
      "R2 credentials are incomplete: set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME or save them in the credentials file.",
    );
  }
  return credentials;
}

function toDocument(row: Row): PairingDocument {
  const size = (value: string | number | null): number | null => {
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  return {
    storageUrl: row.storage_url,
    fileName: row.file_name,
    verifiedChecksum: row.verified_checksum_sha256,
    declaredChecksum: row.declared_checksum_sha256,
    verifiedSize: size(row.verified_byte_size),
    declaredSize: size(row.declared_byte_size),
  };
}

async function main(): Promise<void> {
  const { write, limit } = parseArgs(process.argv.slice(2));
  const credentials = readCredentials();
  const databaseUrl = readDatabaseUrl();
  const bucket = createR2S3Bucket({ ...credentials, fetcher: fetch });
  const ssl = process.env.DATABASE_SSL === "disable" ? false : "require";
  const sql = postgres(databaseUrl, { ssl, max: 1, connect_timeout: 15 });

  const startedAt = new Date().toISOString();
  try {
    // Current versions, plus legacy documents that never got a version row.
    const rows = await sql<Row[]>`
      select v.storage_url, v.file_name,
             v.verified_checksum_sha256, v.declared_checksum_sha256,
             v.verified_byte_size, v.declared_byte_size
      from document_versions v
      where v.superseded_by_version_id is null and v.storage_url like 'documents/%'
      union all
      select d.storage_url, d.file_name, null, null, null, null
      from documents d
      where d.storage_url like 'documents/%'
        and not exists (select 1 from document_versions v where v.document_id = d.id)
      order by storage_url
      limit ${limit}
    `;

    const documents = rows.map(toDocument);
    const summary = await summarizeStoragePairing(documents, async (storageUrl) => {
      try {
        const object = await bucket.head(storageUrl);
        if (!object) return { state: "missing" } satisfies ObjectInspection;
        const rawSize = Number(object.customMetadata?.sizeBytes);
        return {
          state: "present",
          checksumSha256: object.customMetadata?.checksumSha256 ?? null,
          sizeBytes: Number.isSafeInteger(rawSize) ? rawSize : (object.size ?? null),
        } satisfies ObjectInspection;
      } catch (error) {
        return {
          state: "unknown",
          reason: error instanceof Error ? error.message : "head failed",
        } satisfies ObjectInspection;
      }
    });

    const receipt = {
      startedAt,
      finishedAt: new Date().toISOString(),
      limit,
      sampled: summary.sampled,
      present: summary.present,
      missing: summary.missing,
      unknown: summary.unknown,
      checksumMismatches: summary.checksumMismatches,
      sizeMismatches: summary.sizeMismatches,
      metadataIncomplete: summary.metadataIncomplete,
      passed: summary.passed,
      problems: summary.problems.slice(0, 20),
      rows: write ? summary.rows : undefined,
    };

    if (write) {
      writeFileSync("docs/releases/storage-pairing-latest.json", JSON.stringify(receipt, null, 2));
    }
    console.log(
      JSON.stringify(
        {
          sampled: summary.sampled,
          present: summary.present,
          missing: summary.missing,
          unknown: summary.unknown,
          checksumMismatches: summary.checksumMismatches,
          sizeMismatches: summary.sizeMismatches,
          metadataIncomplete: summary.metadataIncomplete,
          passed: summary.passed,
          problems: summary.problems.slice(0, 5),
        },
        null,
        2,
      ),
    );
    if (!summary.passed) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
