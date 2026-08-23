import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createCorporateChangeRequest } from "@/features/corporate-changes/server-fns";
import type { CorporateChangeType } from "@/features/corporate-changes/types";

type CompanyOption = { id: string; companyName: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: CompanyOption[];
  isLoading: boolean;
  hasError: boolean;
  onCreated: (requestId: string) => void;
};

const CHANGE_TYPE_LABELS: Record<CorporateChangeType, string> = {
  name_change: "Name change",
  share_transfer: "Share transfer",
  officer_change: "Officer appointment/resignation/detail change",
  address_change: "Registered address change",
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

function emptyForm() {
  return {
    companyId: "",
    changeType: "address_change" as CorporateChangeType,
    quotedFee: "",
    newRegisteredOffice: "",
    newNameEn: "",
    newNameZh: "",
  };
}

export function CreateCorporateChangeRequestDialog({
  open,
  onOpenChange,
  companies,
  isLoading,
  hasError,
  onCreated,
}: Props) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = <K extends keyof ReturnType<typeof emptyForm>>(
    key: K,
    value: ReturnType<typeof emptyForm>[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const base = { companyId: form.companyId, quotedFee: Number(form.quotedFee) };
      const data =
        form.changeType === "address_change"
          ? { ...base, changeType: form.changeType, newRegisteredOffice: form.newRegisteredOffice }
          : form.changeType === "name_change"
            ? {
                ...base,
                changeType: form.changeType,
                newNameEn: form.newNameEn,
                newNameZh: form.newNameZh.trim() || null,
              }
            : null;
      if (!data) {
        throw new Error(`${form.changeType} is not available from this dialog yet.`);
      }

      const created = await createCorporateChangeRequest({ data: data as never });
      setForm(emptyForm());
      onOpenChange(false);
      onCreated(created.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to create request.");
    } finally {
      setSubmitting(false);
    }
  }

  const isRestrictedType =
    form.changeType === "share_transfer" || form.changeType === "officer_change";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New corporate change request</DialogTitle>
          <DialogDescription>
            Record an ad hoc name change, share transfer, officer change, or address change.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hasError ? (
          <p role="alert" className="text-sm text-destructive">
            Failed to load companies. Try closing and reopening this dialog.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="corp-change-company">
                Company
              </label>
              <select
                id="corp-change-company"
                className={inputClass}
                value={form.companyId}
                onChange={(event) => set("companyId", event.target.value)}
                disabled={isLoading}
                required
              >
                <option value="">Select a company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="corp-change-type">
                Change type
              </label>
              <select
                id="corp-change-type"
                className={inputClass}
                value={form.changeType}
                onChange={(event) => set("changeType", event.target.value as CorporateChangeType)}
              >
                {Object.entries(CHANGE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="corp-change-quoted-fee">
                Quoted fee (HKD)
              </label>
              <input
                id="corp-change-quoted-fee"
                type="number"
                min="0"
                step="1"
                className={inputClass}
                value={form.quotedFee}
                onChange={(event) => set("quotedFee", event.target.value)}
                required
              />
            </div>

            {form.changeType === "address_change" && (
              <div>
                <label className={labelClass} htmlFor="corp-change-new-office">
                  New registered office
                </label>
                <input
                  id="corp-change-new-office"
                  className={inputClass}
                  value={form.newRegisteredOffice}
                  onChange={(event) => set("newRegisteredOffice", event.target.value)}
                  required
                />
              </div>
            )}

            {form.changeType === "name_change" && (
              <>
                <div>
                  <label className={labelClass} htmlFor="corp-change-new-name-en">
                    New English name
                  </label>
                  <input
                    id="corp-change-new-name-en"
                    className={inputClass}
                    value={form.newNameEn}
                    onChange={(event) => set("newNameEn", event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="corp-change-new-name-zh">
                    New Chinese name (optional)
                  </label>
                  <input
                    id="corp-change-new-name-zh"
                    className={inputClass}
                    value={form.newNameZh}
                    onChange={(event) => set("newNameZh", event.target.value)}
                  />
                </div>
              </>
            )}

            {isRestrictedType && (
              <p className="text-sm text-muted-foreground">
                Share transfer and officer change requests need a shareholding/officer picker scoped
                to this company&apos;s register, which is not built yet. Use name change or address
                change here for now.
              </p>
            )}

            {submitError && <p className="text-xs text-destructive">{submitError}</p>}

            <DialogFooter>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.companyId || !form.quotedFee || isRestrictedType}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting ? "Creating…" : "Create request"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
