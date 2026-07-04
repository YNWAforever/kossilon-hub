import { createFileRoute, Link } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { cases, companies, formatDate } from "@/lib/mock-data";
import { FileText, Download } from "lucide-react";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents — Kossilon CoSec OS" },
      { name: "description", content: "Cross-client document library for annual return filings." },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const rows = cases.flatMap((c) => {
    const company = companies.find((co) => co.id === c.companyId)!;
    return c.checklist.map((i) => ({
      id: `${c.id}-${i.id}`,
      caseId: c.id,
      companyId: company.id,
      companyName: company.name,
      label: i.label,
      received: i.received,
      file: i.file,
      requiredBy: i.requiredBy,
    }));
  });

  return (
    <>
      <TopBar title="Documents" subtitle={`${rows.length} document requirements across all cases`} />
      <main className="flex-1 p-6">
        <div className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <input placeholder="Search documents…" className="flex-1 min-w-40 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none" />
            <select className="rounded-md border border-border bg-background px-3 py-1.5 text-sm">
              <option>All statuses</option><option>Received</option><option>Missing</option>
            </select>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Document</th>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Required by</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 40).map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-foreground">{r.label}</p>
                        {r.file && <p className="text-xs text-muted-foreground">{r.file}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Link to="/clients/$id" params={{ id: r.companyId }} className="text-foreground hover:text-primary">{r.companyName}</Link>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{r.requiredBy && formatDate(r.requiredBy)}</td>
                  <td className="px-5 py-3">
                    <StatusPill tone={r.received ? "green" : "yellow"}>{r.received ? "Received" : "Missing"}</StatusPill>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.file && (
                      <button className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                        <Download className="h-3 w-3" /> Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
