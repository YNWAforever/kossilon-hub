// Real client-side document parsing + chunking for the knowledge base.
// Supports TXT/MD, PDF (via pdfjs-dist), and DOCX (via mammoth).

import * as pdfjsLib from "pdfjs-dist";
// Vite serves this worker at a URL we hand to pdfjs.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";

// Register worker exactly once.
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export type ParsedDoc = {
  text: string;
  summary: string;
  chunks: string[];
  pageCount?: number;
};

const MAX_CHARS = 200_000; // safety cap for large PDFs
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export async function parseFile(file: File): Promise<ParsedDoc> {
  const name = file.name.toLowerCase();
  const type = file.type;

  let text = "";
  let pageCount: number | undefined;

  if (name.endsWith(".pdf") || type === "application/pdf") {
    const res = await parsePdf(file);
    text = res.text;
    pageCount = res.pageCount;
  } else if (
    name.endsWith(".docx") ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    text = value;
  } else if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".csv") ||
    type.startsWith("text/")
  ) {
    text = await file.text();
  } else {
    throw new Error(
      `Unsupported file type: ${file.name}. Upload PDF, DOCX, TXT, MD, or CSV.`,
    );
  }

  text = normalize(text).slice(0, MAX_CHARS);
  if (!text.trim()) throw new Error("No extractable text found in this file.");

  const summary = buildSummary(text);
  const chunks = chunkText(text);
  return { text, summary, chunks, pageCount };
}

async function parsePdf(file: File): Promise<{ text: string; pageCount: number }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    pages.push(line);
  }
  return { text: pages.join("\n\n"), pageCount: pdf.numPages };
}

function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildSummary(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 240) return clean;
  const cut = clean.slice(0, 240);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut) + "…";
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + CHUNK_SIZE, text.length);
    // Prefer to break on paragraph/sentence boundary near end.
    let cut = end;
    if (end < text.length) {
      const window = text.slice(i, end);
      const p = window.lastIndexOf("\n\n");
      const s = window.lastIndexOf(". ");
      const b = Math.max(p, s);
      if (b > CHUNK_SIZE * 0.5) cut = i + b + 1;
    }
    chunks.push(text.slice(i, cut).trim());
    if (cut >= text.length) break;
    i = Math.max(cut - CHUNK_OVERLAP, i + 1);
  }
  return chunks.filter((c) => c.length > 0);
}

// Simple keyword scoring — shared with the retrieval engine.
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function scoreChunk(chunk: string, queryTokens: string[]): number {
  const hay = new Set(tokenize(chunk));
  let s = 0;
  for (const q of queryTokens) if (hay.has(q)) s += 1;
  return s;
}
