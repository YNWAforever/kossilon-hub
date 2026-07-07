// Parse FAQ rows from CSV or JSON text.
// Accepted columns/keys (case-insensitive): question, answer, category, tags, active.
// Tags may be comma- or semicolon-separated; active accepts true/false/yes/no/1/0.

import { FAQ_CATEGORIES, type FaqCategory } from "@/lib/knowledge-base";

export type ImportRow = {
  question: string;
  answer: string;
  category?: FaqCategory;
  tags?: string[];
  active?: boolean;
};

export type ImportResult = {
  rows: ImportRow[];
  errors: string[];
};

const parseBool = (v: unknown): boolean | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
};

const parseTags = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (Array.isArray(v))
    return v
      .map(String)
      .map((t) => t.trim())
      .filter(Boolean);
  return String(v)
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
};

const parseCategory = (v: unknown): FaqCategory | undefined => {
  if (!v) return undefined;
  const s = String(v).trim();
  const match = FAQ_CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  return match;
};

function normalizeRow(
  raw: Record<string, unknown>,
  idx: number,
  errors: string[],
): ImportRow | null {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) lower[k.trim().toLowerCase()] = v;
  const question = String(lower.question ?? lower.q ?? "").trim();
  const answer = String(lower.answer ?? lower.a ?? "").trim();
  if (!question || !answer) {
    errors.push(`Row ${idx + 1}: missing question or answer`);
    return null;
  }
  if (question.length > 300) {
    errors.push(`Row ${idx + 1}: question exceeds 300 chars`);
    return null;
  }
  if (answer.length > 4000) {
    errors.push(`Row ${idx + 1}: answer exceeds 4000 chars`);
    return null;
  }
  return {
    question,
    answer,
    category: parseCategory(lower.category),
    tags: parseTags(lower.tags),
    active: parseBool(lower.active),
  };
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields, escaped quotes, CRLF).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        /* skip, handled by \n */
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseFaqImport(text: string, filename: string): ImportResult {
  const errors: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { rows: [], errors: ["File is empty"] };

  const isJson =
    filename.toLowerCase().endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{");

  let raw: Record<string, unknown>[] = [];
  if (isJson) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { faqs?: unknown }).faqs)
          ? (parsed as { faqs: unknown[] }).faqs
          : null;
      if (!arr) return { rows: [], errors: ["JSON must be an array of FAQs or { faqs: [...] }"] };
      raw = arr.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
    } catch (e) {
      return { rows: [], errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
  } else {
    const table = parseCsv(trimmed);
    if (table.length < 2)
      return { rows: [], errors: ["CSV needs a header row and at least one data row"] };
    const header = table[0].map((h) => h.trim().toLowerCase());
    if (!header.includes("question") || !header.includes("answer")) {
      return { rows: [], errors: ["CSV header must include 'question' and 'answer'"] };
    }
    raw = table.slice(1).map((cols) => {
      const obj: Record<string, unknown> = {};
      header.forEach((h, i) => {
        obj[h] = cols[i] ?? "";
      });
      return obj;
    });
  }

  const rows: ImportRow[] = [];
  raw.forEach((r, i) => {
    const n = normalizeRow(r, i, errors);
    if (n) rows.push(n);
  });
  return { rows, errors };
}

export const SAMPLE_CSV = `question,answer,category,tags,active
"What is your turnaround for NAR1?","Typically 1 working day after all documents are signed.",Annual Return,"nar1;turnaround",true
"Do you offer nominee director?","No — we don't provide nominee director services.",General,"nominee;compliance",true
`;
