import { formatDate } from "@/lib/format-date";
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
import { dataOriginLabel } from "@/features/clients/data-origin";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

type Props = {
  companySearch?: string;
  onCompanySearch?: (value: string) => void;
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
  companySearch,
  onCompanySearch,
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
    if (!selectedCompany || isLoading || hasError) return;
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
      toast.success("已建立周年申報案件。");
      onCreated(created.id);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未能建立案件。";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增案件</DialogTitle>
          <DialogDescription>為今年尚未有周年申報案件的公司建立案件。</DialogDescription>
        </DialogHeader>
        {onCompanySearch ? (
          <label className="text-sm">
            搜尋全範圍可建立案件的公司
            <Input
              size="sm"
              className="w-full"
              value={companySearch ?? ""}
              onChange={(event) => onCompanySearch(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              最多顯示200項；搜尋會在你的授權範圍全部公司執行。
            </span>
          </label>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : hasError ? (
          <p role="alert" className="text-sm text-destructive">
            無法載入公司、模板或負責同事資料，請稍後再試。
          </p>
        ) : companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            目前沒有可建立新案件的公司：所有有效公司在本申報年度均已有案件。
          </p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            尚未有啟用中的清單模板。建立案件前，請 Admin 先在設定中設定模板。
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="case-company">
                公司
              </label>
              <Select
                id="case-company"
                size="sm"
                className="w-full"
                value={selectedCompany ? form.companyId : ""}
                onChange={(event) => selectCompany(event.target.value)}
                required
              >
                {!selectedCompany ? (
                  <option value="" disabled>
                    請從目前搜尋結果選擇公司
                  </option>
                ) : null}
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.companyName} ({company.crNumber}) ·{" "}
                    {dataOriginLabel(company.dataOrigin)}
                  </option>
                ))}
              </Select>
              {selectedCompany ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  申報基準日 {formatDate(selectedCompany.annualReturnBasisDate)} · 團隊{" "}
                  {selectedCompany.assignedTeamName}
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelClass} htmlFor="case-template">
                清單模板
              </label>
              <Select
                id="case-template"
                size="sm"
                className="w-full"
                value={form.templateId}
                onChange={(event) => set("templateId", event.target.value)}
                required
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} — {template.serviceType}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className={labelClass} htmlFor="case-owner">
                負責同事
              </label>
              <Select
                id="case-owner"
                size="sm"
                className="w-full"
                value={form.ownerId}
                onChange={(event) => set("ownerId", event.target.value)}
                required
              >
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="case-invoice">
                  發票編號
                </label>
                <Input
                  id="case-invoice"
                  size="sm"
                  className="w-full"
                  value={form.invoiceNumber}
                  onChange={(event) => set("invoiceNumber", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="case-fee">
                  費用（HKD）
                </label>
                <Input
                  id="case-fee"
                  type="number"
                  min="1"
                  step="1"
                  size="sm"
                  className="w-full"
                  value={form.feeAmount}
                  onChange={(event) => set("feeAmount", event.target.value)}
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={saving || !selectedCompany}
              >
                {saving ? "建立中…" : "建立案件"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
