import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getClient } from "@/features/clients/server-fns";
import type { Officer, Shareholding } from "@/features/clients/types";
import { createCorporateChangeRequest } from "@/features/corporate-changes/server-fns";
import type {
  CorporateChangeType,
  CreateAddressChangeInput,
  CreateNameChangeInput,
  CreateOfficerChangeInput,
  CreateShareTransferInput,
  IdentificationType,
  NewOfficerType,
  OfficerAction,
} from "@/features/corporate-changes/types";

type CompanyOption = { id: string; companyName: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: CompanyOption[];
  isLoading: boolean;
  hasError: boolean;
  onCreated: (requestId: string) => void;
};

type CreateChangePayload =
  | ({ changeType: "name_change" } & Omit<CreateNameChangeInput, "actorId">)
  | ({ changeType: "share_transfer" } & Omit<CreateShareTransferInput, "actorId">)
  | ({ changeType: "officer_change" } & Omit<CreateOfficerChangeInput, "actorId">)
  | ({ changeType: "address_change" } & Omit<CreateAddressChangeInput, "actorId">);

const CHANGE_TYPE_LABELS: Record<CorporateChangeType, string> = {
  name_change: "Name change",
  share_transfer: "Share transfer",
  officer_change: "Officer appointment/resignation/detail change",
  address_change: "Registered address change",
};

const NEEDS_REGISTER = new Set<CorporateChangeType>(["share_transfer", "officer_change"]);

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

    // share_transfer
    transferorShareholdingId: "",
    transfereeMode: "new" as "existing" | "new",
    transfereeShareholdingId: "",
    transfereeNewShareholderName: "",
    transfereeNewShareholderAddress: "",
    sharesTransferred: "",
    consideration: "",
    stampDutyAmount: "",

    // officer_change
    officerAction: "appoint" as OfficerAction,
    officerId: "",
    newOfficerType: "director" as NewOfficerType,
    newOfficerName: "",
    newOfficerIdentificationType: "" as IdentificationType | "",
    newOfficerIdentificationNumber: "",
    newOfficerAddress: "",
    effectiveDate: "",
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
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [shareholdings, setShareholdings] = useState<Shareholding[]>([]);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = <K extends keyof ReturnType<typeof emptyForm>>(
    key: K,
    value: ReturnType<typeof emptyForm>[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const previousCompanyId = useRef(form.companyId);

  useEffect(() => {
    // Register-scoped selections (transferor/transferee shareholding, officer) belong to a
    // specific company's register. If the company changes, any such selection made against the
    // previous company's register is no longer valid and must be cleared — otherwise the form
    // can submit companyId: B paired with a shareholding/officer id that actually belongs to A,
    // and nothing downstream (repository insert, DB schema) checks that ownership.
    if (previousCompanyId.current !== form.companyId) {
      previousCompanyId.current = form.companyId;
      setForm((current) => ({
        ...current,
        transferorShareholdingId: "",
        transfereeMode: "new",
        transfereeShareholdingId: "",
        officerId: "",
      }));
    }

    if (!form.companyId || !NEEDS_REGISTER.has(form.changeType)) {
      setOfficers([]);
      setShareholdings([]);
      return;
    }

    let cancelled = false;
    setRegisterLoading(true);
    getClient({ data: { id: form.companyId } })
      .then((client) => {
        if (cancelled) return;
        setOfficers(client?.officers ?? []);
        setShareholdings(client?.shareholdings ?? []);
      })
      .finally(() => {
        if (!cancelled) setRegisterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.changeType]);

  const officerDetailsApply =
    form.officerAction === "appoint" || form.officerAction === "detail_change";

  function buildData(): CreateChangePayload {
    const base = { companyId: form.companyId, quotedFee: Number(form.quotedFee) };

    if (form.changeType === "address_change") {
      return {
        ...base,
        changeType: form.changeType,
        newRegisteredOffice: form.newRegisteredOffice,
      };
    }
    if (form.changeType === "name_change") {
      return {
        ...base,
        changeType: form.changeType,
        newNameEn: form.newNameEn,
        newNameZh: form.newNameZh.trim() || null,
      };
    }
    if (form.changeType === "share_transfer") {
      return {
        ...base,
        changeType: form.changeType,
        transferorShareholdingId: form.transferorShareholdingId,
        sharesTransferred: Number(form.sharesTransferred),
        consideration: Number(form.consideration),
        stampDutyAmount: Number(form.stampDutyAmount),
        transfereeShareholdingId:
          form.transfereeMode === "existing" ? form.transfereeShareholdingId : null,
        transfereeNewShareholderName:
          form.transfereeMode === "new" ? form.transfereeNewShareholderName : null,
        transfereeNewShareholderAddress:
          form.transfereeMode === "new" ? form.transfereeNewShareholderAddress : null,
      };
    }

    return {
      ...base,
      changeType: form.changeType,
      officerAction: form.officerAction,
      officerId: form.officerAction === "appoint" ? null : form.officerId,
      newOfficerType: form.officerAction === "appoint" ? form.newOfficerType : null,
      newOfficerName: officerDetailsApply ? form.newOfficerName : null,
      newOfficerIdentificationType: officerDetailsApply
        ? form.newOfficerIdentificationType || null
        : null,
      newOfficerIdentificationNumber: officerDetailsApply
        ? form.newOfficerIdentificationNumber || null
        : null,
      newOfficerAddress: officerDetailsApply ? form.newOfficerAddress || null : null,
      effectiveDate: form.effectiveDate,
    };
  }

  function isValid(): boolean {
    if (!form.companyId || !form.quotedFee) return false;
    if (form.changeType === "address_change") return Boolean(form.newRegisteredOffice);
    if (form.changeType === "name_change") return Boolean(form.newNameEn);
    if (form.changeType === "share_transfer") {
      const hasTransferee =
        form.transfereeMode === "existing"
          ? Boolean(form.transfereeShareholdingId)
          : Boolean(form.transfereeNewShareholderName);
      return (
        Boolean(form.transferorShareholdingId) &&
        Boolean(form.sharesTransferred) &&
        Boolean(form.consideration) &&
        Boolean(form.stampDutyAmount) &&
        hasTransferee
      );
    }
    if (!form.effectiveDate) return false;
    if (form.officerAction === "appoint") {
      return Boolean(form.newOfficerType) && Boolean(form.newOfficerName);
    }
    if (form.officerAction === "detail_change") {
      return Boolean(form.officerId) && Boolean(form.newOfficerName);
    }
    return Boolean(form.officerId);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createCorporateChangeRequest({ data: buildData() });
      setForm(emptyForm());
      onOpenChange(false);
      onCreated(created.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to create request.");
    } finally {
      setSubmitting(false);
    }
  }

  const activeOfficers = officers.filter((officer) => officer.cessationDate === null);
  const activeShareholdings = shareholdings.filter((holding) => holding.cessationDate === null);

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

            {form.changeType === "share_transfer" && (
              <>
                {registerLoading && (
                  <p className="text-sm text-muted-foreground">
                    Loading the company&apos;s register…
                  </p>
                )}
                <div>
                  <label className={labelClass} htmlFor="corp-change-transferor-shareholding">
                    Transferor shareholding
                  </label>
                  <select
                    id="corp-change-transferor-shareholding"
                    className={inputClass}
                    value={form.transferorShareholdingId}
                    onChange={(event) => set("transferorShareholdingId", event.target.value)}
                    required
                  >
                    <option value="">Select a shareholding</option>
                    {activeShareholdings.map((holding) => (
                      <option key={holding.id} value={holding.id}>
                        {holding.shareholderName}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset className="space-y-1">
                  <legend className={labelClass}>Transferee</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="corp-change-transferee-mode"
                      checked={form.transfereeMode === "existing"}
                      onChange={() => set("transfereeMode", "existing")}
                    />
                    Existing shareholder
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="corp-change-transferee-mode"
                      checked={form.transfereeMode === "new"}
                      onChange={() => set("transfereeMode", "new")}
                    />
                    New shareholder
                  </label>
                </fieldset>

                {form.transfereeMode === "existing" ? (
                  <div>
                    <label className={labelClass} htmlFor="corp-change-transferee-shareholding">
                      Transferee shareholding
                    </label>
                    <select
                      id="corp-change-transferee-shareholding"
                      className={inputClass}
                      value={form.transfereeShareholdingId}
                      onChange={(event) => set("transfereeShareholdingId", event.target.value)}
                      required
                    >
                      <option value="">Select a shareholding</option>
                      {activeShareholdings
                        .filter((holding) => holding.id !== form.transferorShareholdingId)
                        .map((holding) => (
                          <option key={holding.id} value={holding.id}>
                            {holding.shareholderName}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-transferee-new-name">
                        New shareholder name
                      </label>
                      <input
                        id="corp-change-transferee-new-name"
                        className={inputClass}
                        value={form.transfereeNewShareholderName}
                        onChange={(event) =>
                          set("transfereeNewShareholderName", event.target.value)
                        }
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-transferee-new-address">
                        New shareholder address
                      </label>
                      <input
                        id="corp-change-transferee-new-address"
                        className={inputClass}
                        value={form.transfereeNewShareholderAddress}
                        onChange={(event) =>
                          set("transfereeNewShareholderAddress", event.target.value)
                        }
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className={labelClass} htmlFor="corp-change-shares-transferred">
                    Shares transferred
                  </label>
                  <input
                    id="corp-change-shares-transferred"
                    type="number"
                    min="1"
                    step="1"
                    className={inputClass}
                    value={form.sharesTransferred}
                    onChange={(event) => set("sharesTransferred", event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="corp-change-consideration">
                    Consideration (HKD)
                  </label>
                  <input
                    id="corp-change-consideration"
                    type="number"
                    min="0"
                    step="1"
                    className={inputClass}
                    value={form.consideration}
                    onChange={(event) => set("consideration", event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="corp-change-stamp-duty">
                    Stamp duty (HKD)
                  </label>
                  <input
                    id="corp-change-stamp-duty"
                    type="number"
                    min="0"
                    step="1"
                    className={inputClass}
                    value={form.stampDutyAmount}
                    onChange={(event) => set("stampDutyAmount", event.target.value)}
                    required
                  />
                </div>
              </>
            )}

            {form.changeType === "officer_change" && (
              <>
                {registerLoading && (
                  <p className="text-sm text-muted-foreground">
                    Loading the company&apos;s register…
                  </p>
                )}
                <div>
                  <label className={labelClass} htmlFor="corp-change-officer-action">
                    Officer action
                  </label>
                  <select
                    id="corp-change-officer-action"
                    className={inputClass}
                    value={form.officerAction}
                    onChange={(event) => set("officerAction", event.target.value as OfficerAction)}
                  >
                    <option value="appoint">Appoint</option>
                    <option value="resign">Resign</option>
                    <option value="detail_change">Detail change</option>
                  </select>
                </div>

                {form.officerAction !== "appoint" && (
                  <div>
                    <label className={labelClass} htmlFor="corp-change-officer">
                      Officer
                    </label>
                    <select
                      id="corp-change-officer"
                      className={inputClass}
                      value={form.officerId}
                      onChange={(event) => set("officerId", event.target.value)}
                      required
                    >
                      <option value="">Select an officer</option>
                      {activeOfficers.map((officer) => (
                        <option key={officer.id} value={officer.id}>
                          {officer.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {form.officerAction === "appoint" && (
                  <div>
                    <label className={labelClass} htmlFor="corp-change-new-officer-type">
                      New officer type
                    </label>
                    <select
                      id="corp-change-new-officer-type"
                      className={inputClass}
                      value={form.newOfficerType}
                      onChange={(event) =>
                        set("newOfficerType", event.target.value as NewOfficerType)
                      }
                    >
                      <option value="director">Director</option>
                      <option value="secretary">Secretary</option>
                    </select>
                  </div>
                )}

                {officerDetailsApply && (
                  <>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-name">
                        {form.officerAction === "appoint" ? "New officer name" : "Updated name"}
                      </label>
                      <input
                        id="corp-change-new-officer-name"
                        className={inputClass}
                        value={form.newOfficerName}
                        onChange={(event) => set("newOfficerName", event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-id-type">
                        Identification type
                      </label>
                      <select
                        id="corp-change-new-officer-id-type"
                        className={inputClass}
                        value={form.newOfficerIdentificationType}
                        onChange={(event) =>
                          set(
                            "newOfficerIdentificationType",
                            event.target.value as IdentificationType | "",
                          )
                        }
                      >
                        <option value="">None</option>
                        <option value="hkid">HKID</option>
                        <option value="passport">Passport</option>
                        <option value="br_number">BR number</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-id-number">
                        Identification number
                      </label>
                      <input
                        id="corp-change-new-officer-id-number"
                        className={inputClass}
                        value={form.newOfficerIdentificationNumber}
                        onChange={(event) =>
                          set("newOfficerIdentificationNumber", event.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-address">
                        Address
                      </label>
                      <input
                        id="corp-change-new-officer-address"
                        className={inputClass}
                        value={form.newOfficerAddress}
                        onChange={(event) => set("newOfficerAddress", event.target.value)}
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className={labelClass} htmlFor="corp-change-effective-date">
                    Effective date
                  </label>
                  <input
                    id="corp-change-effective-date"
                    type="date"
                    className={inputClass}
                    value={form.effectiveDate}
                    onChange={(event) => set("effectiveDate", event.target.value)}
                    required
                  />
                </div>
              </>
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
                disabled={submitting || !isValid()}
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
