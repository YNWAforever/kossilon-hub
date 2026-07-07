import {
  addFaq,
  addReferenceDoc,
  deleteFaq,
  deleteReferenceDoc,
  duplicateFaq,
  updateFaq,
  updateReferenceDoc,
  useKnowledgeBase,
  type KnowledgeCategory,
} from "../lib/knowledge-base";

const categories: KnowledgeCategory[] = [
  "Incorporation",
  "Annual Return",
  "Payments",
  "Deregistration",
  "General",
];

export function KnowledgeBaseSection() {
  const { faqs, referenceDocs } = useKnowledgeBase();

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Knowledge base</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Curated answers and reference documents used by the mocked WhatsApp assistant.
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="font-semibold">FAQ manager</h3>
            <p className="text-sm text-muted-foreground">{faqs.length} entries</p>
          </div>
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={addFaq}
          >
            Add FAQ
          </button>
        </div>
        <div className="divide-y">
          {faqs.map((faq) => (
            <article key={faq.id} className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1.4fr_160px_120px]">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Question</span>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={faq.question}
                  onChange={(event) => updateFaq(faq.id, { question: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Answer</span>
                <textarea
                  className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
                  value={faq.answer}
                  onChange={(event) => updateFaq(faq.id, { answer: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Category</span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={faq.category}
                  onChange={(event) =>
                    updateFaq(faq.id, { category: event.target.value as KnowledgeCategory })
                  }
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={faq.tags.join(", ")}
                  onChange={(event) =>
                    updateFaq(faq.id, {
                      tags: event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={faq.active}
                    onChange={(event) => updateFaq(faq.id, { active: event.target.checked })}
                  />
                  Active
                </label>
                <button
                  className="rounded-md border px-3 py-2 text-sm"
                  onClick={() => duplicateFaq(faq.id)}
                >
                  Duplicate
                </button>
                <button
                  className="rounded-md border px-3 py-2 text-sm text-destructive"
                  onClick={() => deleteFaq(faq.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="font-semibold">Reference documents</h3>
            <p className="text-sm text-muted-foreground">Metadata-only mock upload library</p>
          </div>
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={addReferenceDoc}
          >
            Simulate upload
          </button>
        </div>
        <div className="divide-y">
          {referenceDocs.map((doc) => (
            <article key={doc.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_1.4fr_130px]">
              <div className="space-y-2">
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-medium"
                  value={doc.title}
                  onChange={(event) => updateReferenceDoc(doc.id, { title: event.target.value })}
                />
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={doc.filename}
                  onChange={(event) => updateReferenceDoc(doc.id, { filename: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={doc.category}
                  onChange={(event) =>
                    updateReferenceDoc(doc.id, {
                      category: event.target.value as KnowledgeCategory,
                    })
                  }
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
                <input
                  type="date"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={doc.updatedAt}
                  onChange={(event) =>
                    updateReferenceDoc(doc.id, { updatedAt: event.target.value })
                  }
                />
              </div>
              <textarea
                className="min-h-20 resize-y rounded-md border bg-background px-3 py-2 text-sm"
                value={doc.summary}
                onChange={(event) => updateReferenceDoc(doc.id, { summary: event.target.value })}
              />
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={doc.active}
                    onChange={(event) =>
                      updateReferenceDoc(doc.id, { active: event.target.checked })
                    }
                  />
                  Active
                </label>
                <button
                  className="rounded-md border px-3 py-2 text-sm text-destructive"
                  onClick={() => deleteReferenceDoc(doc.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
