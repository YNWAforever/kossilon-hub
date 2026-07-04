import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useFaqs,
  useReferenceDocs,
  kbStore,
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
} from "lucide-react";
import { cn } from "@/lib/utils";

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

  const filtered = useMemo(
    () =>
      faqs.filter(
        (f) =>
          (category === "All" || f.category === category) &&
          (query === "" ||
            f.question.toLowerCase().includes(query.toLowerCase()) ||
            f.answer.toLowerCase().includes(query.toLowerCase()) ||
            f.tags.some((t) => t.toLowerCase().includes(query.toLowerCase()))),
      ),
    [faqs, query, category],
  );

  const active = faqs.filter((f) => f.active).length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold text-foreground">FAQ knowledge base</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active} active · used by the AI to draft WhatsApp replies
          </p>
        </div>
        <button
          onClick={() => setExpanded(kbStore.addFaq())}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> Add FAQ
        </button>
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
            <option key={c} value={c}>{c}</option>
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

function FaqRow({ f, expanded, onToggle }: { f: FaqEntry; expanded: boolean; onToggle: () => void }) {
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
            onClick={(e) => { e.stopPropagation(); kbStore.duplicateFaq(f.id); }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Duplicate"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); kbStore.removeFaq(f.id); }}
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
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Question</span>
            <input
              value={f.question}
              onChange={(e) => kbStore.updateFaq(f.id, { question: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Answer (markdown)</span>
            <textarea
              value={f.answer}
              onChange={(e) => kbStore.updateFaq(f.id, { answer: e.target.value })}
              rows={5}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
              <select
                value={f.category}
                onChange={(e) => kbStore.updateFaq(f.id, { category: e.target.value as FaqCategory })}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {FAQ_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tags (comma separated)</span>
              <input
                value={f.tags.join(", ")}
                onChange={(e) =>
                  kbStore.updateFaq(f.id, {
                    tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
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
            <h2 className="font-display text-base font-semibold text-foreground">Reference documents</h2>
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
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
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
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
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
          onClick={(e) => { e.stopPropagation(); kbStore.removeDoc(d.id); }}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border bg-background/40 p-5">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Title</span>
            <input
              value={d.title}
              onChange={(e) => kbStore.updateDoc(d.id, { title: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</span>
            <textarea
              value={d.summary}
              onChange={(e) => kbStore.updateDoc(d.id, { summary: e.target.value })}
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
              <select
                value={d.category}
                onChange={(e) => kbStore.updateDoc(d.id, { category: e.target.value as FaqCategory })}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {FAQ_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
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
                {d.extractedText.slice(0, 1200)}{d.extractedText.length > 1200 ? "\n…" : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
