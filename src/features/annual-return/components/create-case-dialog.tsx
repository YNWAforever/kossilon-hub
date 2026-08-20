import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActiveChecklistTemplateSummary } from "@/features/checklist-templates/server-fns";
import type { ClientAssignmentOptions } from "@/features/clients/types";
import { createAnnualReturnCase } from "../server-fns";
import type { EligibleCompanyForCase } from "../repository";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: EligibleCompanyForCase[];
  templates: ActiveChecklistTemplateSummary[];
  owners: ClientAssignmentOptions["owners"];
  onCreated: (caseId: string) => void;
};

type FormState = {
  companyId: string;
  templateId: string;
  ownerId: string;
  invoiceNumber: string;
  feeAmount: string;
};

function emptyForm(
  companies: EligibleCompanyForCase[],
  templates: ActiveChecklistTemplateSummary[],
): FormState {
  const firstCompany = companies[0];
  return {
    companyId: firstCompany?.id ?? "",
    templateId: templates[0]?.id ?? "",
    ownerId: firstCompany?.assignedOwnerId ?? "",
    invoiceNumber: "",
    feeAmount: "",
  };
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function CreateCaseDialog({
  open,
  onOpenChange,
  companies,
  templates,
  owners,
  onCreated,
}: Props) {
  const [form, setForm] = useState<FormState>(() => emptyForm(companies, templates));
  const [saving, setSaving] = useState(false);

  // Only re-derive when the dialog transitions open, not on every companies/templates
  // refetch while it's already open — that would blow away whatever the user is
  // mid-filling-in.
  useEffect(() => {
    if (open) {
      setForm(emptyForm(companies, templates));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === form.companyId),
    [companies, form.companyId],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function selectCompany(companyId: string) {
    const company = companies.find((candidate) => candidate.id === companyId);
    setForm((current) => ({
      ...current,
      companyId,
      ownerId: company?.assignedOwnerId ?? current.ownerId,
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      const created = await createAnnualReturnCase({
        data: {
          companyId: form.companyId,
          templateId: form.templateId,
          ownerId: form.ownerId,
          invoiceNumber: form.invoiceNumber,
          feeAmount: Number(form.feeAmount),
        },
      });
      toast.success("Annual return case created.");
      onCreated(created.id);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create the case.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New case</DialogTitle>
          <DialogDescription>
            Create an annual return case for a company that doesn't have one yet this year.
          </DialogDescription>
        </DialogHeader>

        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No companies are eligible for a new case right now — every active company already has
            one for its current return year.
          </p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active checklist templates exist yet. Ask an Admin to configure one under Settings
            before creating a case.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="case-company">
                Company
              </label>
              <select
                id="case-company"
                className={inputClass}
                value={form.companyId}
                onChange={(event) => selectCompany(event.target.value)}
                required
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.companyName} ({company.crNumber})
                  </option>
                ))}
              </select>
              {selectedCompany ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Basis date {selectedCompany.annualReturnBasisDate} · Team{" "}
                  {selectedCompany.assignedTeamName}
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelClass} htmlFor="case-template">
                Checklist template
              </label>
              <select
                id="case-template"
                className={inputClass}
                value={form.templateId}
                onChange={(event) => set("templateId", event.target.value)}
                required
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} — {template.serviceType}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="case-owner">
                Owner
              </label>
              <select
                id="case-owner"
                className={inputClass}
                value={form.ownerId}
                onChange={(event) => set("ownerId", event.target.value)}
                required
              >
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="case-invoice">
                  Invoice number
                </label>
                <input
                  id="case-invoice"
                  className={inputClass}
                  value={form.invoiceNumber}
                  onChange={(event) => set("invoiceNumber", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="case-fee">
                  Fee (HKD)
                </label>
                <input
                  id="case-fee"
                  type="number"
                  min="1"
                  step="1"
                  className={inputClass}
                  value={form.feeAmount}
                  onChange={(event) => set("feeAmount", event.target.value)}
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? "Creating…" : "Create case"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
