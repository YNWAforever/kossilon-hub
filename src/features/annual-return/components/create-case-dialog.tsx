import { useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * True while the parent's companies/templates/owners queries are still
   * resolving. Without this the dialog cannot tell "confirmed zero results"
   * apart from "hasn't loaded yet" — and since those queries only start once
   * the dialog opens, every open would otherwise show a false "no companies
   * are eligible" message for a moment before the real data arrives.
   */
  isLoading: boolean;
  /** True if any of the three source queries failed. Without this, a real
   * fetch failure renders as the misleading "no companies/templates" empty
   * state instead of a genuine error — companies/templates default to `[]`
   * on error the same way they do while genuinely empty. */
  hasError: boolean;
  onCreated: (caseId: string) => void;
};

type FormState = {
  companyId: string;
  templateId: string;
  ownerId: string;
  invoiceNumber: string;
  feeAmount: string;
};

/**
 * A company's assigned owner is only used as the default if they're actually
 * in the (active-only) owners list — otherwise a deactivated owner would be
 * silently submitted with no matching <option> shown on screen.
 */
function defaultOwnerId(
  company: EligibleCompanyForCase | undefined,
  owners: ClientAssignmentOptions["owners"],
): string {
  if (company && owners.some((owner) => owner.id === company.assignedOwnerId)) {
    return company.assignedOwnerId;
  }
  return owners[0]?.id ?? "";
}

function emptyForm(
  companies: EligibleCompanyForCase[],
  templates: ActiveChecklistTemplateSummary[],
  owners: ClientAssignmentOptions["owners"],
): FormState {
  const firstCompany = companies[0];
  return {
    companyId: firstCompany?.id ?? "",
    templateId: templates[0]?.id ?? "",
    ownerId: defaultOwnerId(firstCompany, owners),
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
  isLoading,
  hasError,
  onCreated,
}: Props) {
  const [form, setForm] = useState<FormState>(() => emptyForm(companies, templates, owners));
  const [saving, setSaving] = useState(false);
  const initializedRef = useRef(false);

  // Re-derives the form exactly once per open: not on the first render (data
  // is still loading, per isLoading), but the moment loading finishes. Further
  // background refetches while the dialog stays open do NOT re-run this, so a
  // user's in-progress edit is never clobbered — initializedRef only resets
  // when the dialog closes.
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (isLoading || initializedRef.current) return;
    setForm(emptyForm(companies, templates, owners));
    initializedRef.current = true;
  }, [open, isLoading, companies, templates, owners]);

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
      ownerId: defaultOwnerId(company, owners),
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hasError ? (
          <p role="alert" className="text-sm text-destructive">
            Unable to load company, template, or owner data. Try again shortly.
          </p>
        ) : companies.length === 0 ? (
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
