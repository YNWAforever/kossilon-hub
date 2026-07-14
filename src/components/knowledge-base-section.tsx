import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useFaqs,
  useReferenceDocs,
  kbStore,
  filterFaqEntries,
  FAQ_CATEGORIES,
  type FaqCategory,
  type FaqEntry,
  type ReferenceDoc,
} from "@/lib/knowledge-base";
import { StatusPill } from "@/components/status-pill";
import {
  BookOpen,
  FileUp,
  Plus,
  Copy,
  Trash2,
  Search,
  FileText,
  MessageSquare,
  Loader2,
  Sparkles,
  Upload,
  X,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { parseFaqImport, SAMPLE_CSV, type ImportRow } from "@/lib/faq-import";

const categoryTone = (c: FaqCategory) =>
  c === "Annual Return"
    ? "blue"
    : c === "Incorporation"
      ? "green"
      : c === "Payments"
        ? "yellow"
        : c === "Deregistration"
          ? "orange"
          : "neutral";

export function KnowledgeBaseSection() {
  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <FaqManager />
        </div>
        <div className="lg:col-span-2">
          <ReferenceDocsManager />
        </div>
      </div>
    </section>
  );
}

function FaqManager() {
  const faqs = useFaqs();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FaqCategory | "All">("All");
  const [expanded, setExpanded] = useState<string | null>(faqs[0]?.id ?? null);

  const filtered = useMemo(() => filterFaqEntries(faqs, query, category), [faqs, query, category]);

  const active = faqs.filter((f) => f.active).length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold text-foreground">
              FAQ knowledge base
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active} active · used by the AI to draft WhatsApp replies
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <FaqImportButton />
          <button
            onClick={() => setExpanded(kbStore.addFaq())}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Add FAQ
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative flex-1 min-w-40">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions, answers, tags…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FaqCategory | "All")}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="All">All categories</option>
          {FAQ_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
        {filtered.length === 0 && (
          <li className="px-5 py-8 text-center text-xs text-muted-foreground">No FAQs match.</li>
        )}
        {filtered.map((f) => (
          <FaqRow
            key={f.id}
            f={f}
            expanded={expanded === f.id}
            onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function FaqRow({
  f,
  expanded,
  onToggle,
}: {
  f: FaqEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40 cursor-pointer",
          expanded && "bg-accent/40",
        )}
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusPill tone={categoryTone(f.category)}>{f.category}</StatusPill>
            {!f.active && <StatusPill tone="neutral">Draft</StatusPill>}
          </div>
          <p className="mt-1 truncate text-sm font-medium text-foreground">{f.question}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              kbStore.duplicateFaq(f.id);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Duplicate"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              kbStore.removeFaq(f.id);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-border bg-background/40 p-5">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Question
            </span>
            <input
              value={f.question}
              onChange={(e) => kbStore.updateFaq(f.id, { question: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Answer (markdown)
            </span>
            <textarea
              value={f.answer}
              onChange={(e) => kbStore.updateFaq(f.id, { answer: e.target.value })}
              rows={5}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Category
              </span>
              <select
                value={f.category}
                onChange={(e) =>
                  kbStore.updateFaq(f.id, { category: e.target.value as FaqCategory })
                }
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {FAQ_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tags (comma separated)
              </span>
              <input
                value={f.tags.join(", ")}
                onChange={(e) =>
                  kbStore.updateFaq(f.id, {
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={f.active}
              onChange={(e) => kbStore.updateFaq(f.id, { active: e.target.checked })}
            />
            <span className="text-muted-foreground">Active — used by the AI</span>
          </label>
        </div>
      )}
    </li>
  );
}

function ReferenceDocsManager() {
  const docs = useReferenceDocs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of arr) {
      try {
        await kbStore.uploadDoc(file);
        ok++;
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`);
      }
    }
    setUploading(false);
    if (ok > 0) toast.success(`Indexed ${ok} document${ok === 1 ? "" : "s"}`);
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold text-foreground">
              Reference documents
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {docs.filter((d) => d.active).length} active · text-indexed for AI retrieval
          </p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileUp className="h-3.5 w-3.5" />
          )}
          {uploading ? "Indexing…" : "Upload document"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "mx-3 my-3 rounded-lg border border-dashed border-border px-4 py-3 text-center text-[11px] text-muted-foreground transition-colors",
          dragOver && "border-primary bg-primary/5 text-primary",
        )}
      >
        Drop PDF, DOCX, TXT, MD, or CSV here — text is extracted & indexed in your browser
      </div>
      <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
        {docs.map((d) => (
          <DocRow key={d.id} d={d} />
        ))}
      </ul>
    </div>
  );
}

function DocRow({ d }: { d: ReferenceDoc }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div
        className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40 cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{d.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {d.filename} · {d.sizeKb} KB{d.pageCount ? ` · ${d.pageCount}p` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPill tone={categoryTone(d.category)}>{d.category}</StatusPill>
            {d.chunks && d.chunks.length > 0 ? (
              <StatusPill tone="green">
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> Indexed · {d.chunks.length} chunks
                </span>
              </StatusPill>
            ) : (
              <StatusPill tone="neutral">Metadata only</StatusPill>
            )}
            {!d.active && <StatusPill tone="neutral">Inactive</StatusPill>}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            kbStore.removeDoc(d.id);
          }}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border bg-background/40 p-5">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Title
            </span>
            <input
              value={d.title}
              onChange={(e) => kbStore.updateDoc(d.id, { title: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </span>
            <textarea
              value={d.summary}
              onChange={(e) => kbStore.updateDoc(d.id, { summary: e.target.value })}
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Category
              </span>
              <select
                value={d.category}
                onChange={(e) =>
                  kbStore.updateDoc(d.id, { category: e.target.value as FaqCategory })
                }
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {FAQ_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-end gap-2 text-xs">
              <input
                type="checkbox"
                checked={d.active}
                onChange={(e) => kbStore.updateDoc(d.id, { active: e.target.checked })}
              />
              <span className="text-muted-foreground">Active</span>
            </label>
          </div>
          {d.extractedText && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Indexed content preview
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {d.extractedText.slice(0, 1200)}
                {d.extractedText.length > 1200 ? "\n…" : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function FaqImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
      >
        <Upload className="h-3.5 w-3.5" /> Import
      </button>
      {open && <FaqImportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function FaqImportDialog({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("import.csv");
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [parsed, setParsed] = useState(false);

  const runParse = (content: string, name: string) => {
    const { rows, errors: errs } = parseFaqImport(content, name);
    setPreview(rows);
    setErrors(errs);
    setParsed(true);
  };

  const onFile = async (file: File) => {
    const content = await file.text();
    setText(content);
    setFilename(file.name);
    runParse(content, file.name);
  };

  const commit = () => {
    if (preview.length === 0) return;
    const { added, updated } = kbStore.importFaqs(preview);
    toast.success(
      `Imported ${preview.length} FAQ${preview.length === 1 ? "" : "s"} · ${added} new, ${updated} updated`,
    );
    onClose();
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "faq-import-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-foreground">Import FAQs</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Upload a CSV or JSON file. Columns: <code className="text-foreground">question</code>,{" "}
              <code className="text-foreground">answer</code>, <code>category</code>,{" "}
              <code>tags</code>, <code>active</code>. Duplicates by question are updated in place.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <FileUp className="h-3.5 w-3.5" /> Choose file
            </button>
            <button
              onClick={downloadSample}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" /> Sample CSV
            </button>
            {parsed && (
              <span className="text-[11px] text-muted-foreground">
                {filename} · {preview.length} valid row{preview.length === 1 ? "" : "s"}
                {errors.length > 0 ? ` · ${errors.length} skipped` : ""}
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Or paste CSV / JSON
            </span>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setParsed(false);
              }}
              onBlur={() => text.trim() && runParse(text, filename)}
              rows={6}
              placeholder={SAMPLE_CSV}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {errors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs font-semibold text-destructive">
                Skipped {errors.length} row{errors.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-destructive/80">
                {errors.slice(0, 6).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {errors.length > 6 && <li>…and {errors.length - 6} more</li>}
              </ul>
            </div>
          )}

          {preview.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                <span>Preview ({preview.length})</span>
                <span>Duplicates by question are merged</span>
              </div>
              <ul className="max-h-56 divide-y divide-border overflow-y-auto">
                {preview.slice(0, 40).map((r, i) => (
                  <li key={i} className="px-3 py-2">
                    <p className="truncate text-xs font-medium text-foreground">{r.question}</p>
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">{r.answer}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <StatusPill tone={categoryTone(r.category ?? "General")}>
                        {r.category ?? "General"}
                      </StatusPill>
                      {r.tags && r.tags.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {r.tags.join(", ")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
                {preview.length > 40 && (
                  <li className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                    …and {preview.length - 40} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-2 text-xs font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={preview.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> Import{" "}
            {preview.length > 0 ? `${preview.length} FAQ${preview.length === 1 ? "" : "s"}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
