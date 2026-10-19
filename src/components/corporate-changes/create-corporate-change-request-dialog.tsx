import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
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
import { CORPORATE_CHANGE_TYPE_LABELS } from "@/features/corporate-changes/labels";
import { IDENTIFICATION_TYPE_LABELS, OFFICER_TYPE_LABELS } from "@/features/clients/labels";

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

const NEEDS_REGISTER = new Set<CorporateChangeType>(["share_transfer", "officer_change"]);

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
      setSubmitError(error instanceof Error ? error.message : "未能建立申請。");
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
          <DialogTitle>新增公司變更申請</DialogTitle>
          <DialogDescription>
            記錄臨時的公司名稱變更、股份轉讓、高級人員變更或註冊辦事處地址變更。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : hasError ? (
          <p role="alert" className="text-sm text-destructive">
            未能載入公司清單，請關閉後重新開啟此視窗。
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="corp-change-company">
                公司
              </label>
              <Select
                id="corp-change-company"
                size="sm"
                className="w-full"
                value={form.companyId}
                onChange={(event) => set("companyId", event.target.value)}
                disabled={isLoading}
                required
              >
                <option value="">選擇公司</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.companyName}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className={labelClass} htmlFor="corp-change-type">
                變更類別
              </label>
              <Select
                id="corp-change-type"
                size="sm"
                className="w-full"
                value={form.changeType}
                onChange={(event) => set("changeType", event.target.value as CorporateChangeType)}
              >
                {Object.entries(CORPORATE_CHANGE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className={labelClass} htmlFor="corp-change-quoted-fee">
                報價（HKD）
              </label>
              <Input
                id="corp-change-quoted-fee"
                type="number"
                min="0"
                step="1"
                size="sm"
                className="w-full"
                value={form.quotedFee}
                onChange={(event) => set("quotedFee", event.target.value)}
                required
              />
            </div>

            {form.changeType === "address_change" && (
              <div>
                <label className={labelClass} htmlFor="corp-change-new-office">
                  新註冊辦事處地址
                </label>
                <Input
                  id="corp-change-new-office"
                  size="sm"
                  className="w-full"
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
                    新英文名稱
                  </label>
                  <Input
                    id="corp-change-new-name-en"
                    size="sm"
                    className="w-full"
                    value={form.newNameEn}
                    onChange={(event) => set("newNameEn", event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="corp-change-new-name-zh">
                    新中文名稱（選填）
                  </label>
                  <Input
                    id="corp-change-new-name-zh"
                    size="sm"
                    className="w-full"
                    value={form.newNameZh}
                    onChange={(event) => set("newNameZh", event.target.value)}
                  />
                </div>
              </>
            )}

            {form.changeType === "share_transfer" && (
              <>
                {registerLoading && (
                  <p className="text-sm text-muted-foreground">載入公司登記冊中…</p>
                )}
                <div>
                  <label className={labelClass} htmlFor="corp-change-transferor-shareholding">
                    轉讓人股權
                  </label>
                  <Select
                    id="corp-change-transferor-shareholding"
                    size="sm"
                    className="w-full"
                    value={form.transferorShareholdingId}
                    onChange={(event) => set("transferorShareholdingId", event.target.value)}
                    required
                  >
                    <option value="">選擇股權</option>
                    {activeShareholdings.map((holding) => (
                      <option key={holding.id} value={holding.id}>
                        {holding.shareholderName}
                      </option>
                    ))}
                  </Select>
                </div>

                <fieldset className="space-y-1">
                  <legend className={labelClass}>承讓人</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="corp-change-transferee-mode"
                      checked={form.transfereeMode === "existing"}
                      onChange={() => set("transfereeMode", "existing")}
                    />
                    現有股東
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="corp-change-transferee-mode"
                      checked={form.transfereeMode === "new"}
                      onChange={() => set("transfereeMode", "new")}
                    />
                    新股東
                  </label>
                </fieldset>

                {form.transfereeMode === "existing" ? (
                  <div>
                    <label className={labelClass} htmlFor="corp-change-transferee-shareholding">
                      承讓人股權
                    </label>
                    <Select
                      id="corp-change-transferee-shareholding"
                      size="sm"
                      className="w-full"
                      value={form.transfereeShareholdingId}
                      onChange={(event) => set("transfereeShareholdingId", event.target.value)}
                      required
                    >
                      <option value="">選擇股權</option>
                      {activeShareholdings
                        .filter((holding) => holding.id !== form.transferorShareholdingId)
                        .map((holding) => (
                          <option key={holding.id} value={holding.id}>
                            {holding.shareholderName}
                          </option>
                        ))}
                    </Select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-transferee-new-name">
                        新股東名稱
                      </label>
                      <Input
                        id="corp-change-transferee-new-name"
                        size="sm"
                        className="w-full"
                        value={form.transfereeNewShareholderName}
                        onChange={(event) =>
                          set("transfereeNewShareholderName", event.target.value)
                        }
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-transferee-new-address">
                        新股東地址
                      </label>
                      <Input
                        id="corp-change-transferee-new-address"
                        size="sm"
                        className="w-full"
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
                    轉讓股數
                  </label>
                  <Input
                    id="corp-change-shares-transferred"
                    type="number"
                    min="1"
                    step="1"
                    size="sm"
                    className="w-full"
                    value={form.sharesTransferred}
                    onChange={(event) => set("sharesTransferred", event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="corp-change-consideration">
                    代價（HKD）
                  </label>
                  <Input
                    id="corp-change-consideration"
                    type="number"
                    min="0"
                    step="1"
                    size="sm"
                    className="w-full"
                    value={form.consideration}
                    onChange={(event) => set("consideration", event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="corp-change-stamp-duty">
                    印花稅（HKD）
                  </label>
                  <Input
                    id="corp-change-stamp-duty"
                    type="number"
                    min="0"
                    step="1"
                    size="sm"
                    className="w-full"
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
                  <p className="text-sm text-muted-foreground">載入公司登記冊中…</p>
                )}
                <div>
                  <label className={labelClass} htmlFor="corp-change-officer-action">
                    高級人員變更事項
                  </label>
                  <Select
                    id="corp-change-officer-action"
                    size="sm"
                    className="w-full"
                    value={form.officerAction}
                    onChange={(event) => set("officerAction", event.target.value as OfficerAction)}
                  >
                    <option value="appoint">委任</option>
                    <option value="resign">辭任</option>
                    <option value="detail_change">資料變更</option>
                  </Select>
                </div>

                {form.officerAction !== "appoint" && (
                  <div>
                    <label className={labelClass} htmlFor="corp-change-officer">
                      高級人員
                    </label>
                    <Select
                      id="corp-change-officer"
                      size="sm"
                      className="w-full"
                      value={form.officerId}
                      onChange={(event) => set("officerId", event.target.value)}
                      required
                    >
                      <option value="">選擇高級人員</option>
                      {activeOfficers.map((officer) => (
                        <option key={officer.id} value={officer.id}>
                          {officer.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                {form.officerAction === "appoint" && (
                  <div>
                    <label className={labelClass} htmlFor="corp-change-new-officer-type">
                      新高級人員類別
                    </label>
                    <Select
                      id="corp-change-new-officer-type"
                      size="sm"
                      className="w-full"
                      value={form.newOfficerType}
                      onChange={(event) =>
                        set("newOfficerType", event.target.value as NewOfficerType)
                      }
                    >
                      <option value="director">{OFFICER_TYPE_LABELS.director}</option>
                      <option value="secretary">{OFFICER_TYPE_LABELS.secretary}</option>
                    </Select>
                  </div>
                )}

                {officerDetailsApply && (
                  <>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-name">
                        {form.officerAction === "appoint" ? "新高級人員姓名" : "更新後姓名"}
                      </label>
                      <Input
                        id="corp-change-new-officer-name"
                        size="sm"
                        className="w-full"
                        value={form.newOfficerName}
                        onChange={(event) => set("newOfficerName", event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-id-type">
                        身份證明類別
                      </label>
                      <Select
                        id="corp-change-new-officer-id-type"
                        size="sm"
                        className="w-full"
                        value={form.newOfficerIdentificationType}
                        onChange={(event) =>
                          set(
                            "newOfficerIdentificationType",
                            event.target.value as IdentificationType | "",
                          )
                        }
                      >
                        <option value="">無</option>
                        <option value="hkid">{IDENTIFICATION_TYPE_LABELS.hkid}</option>
                        <option value="passport">{IDENTIFICATION_TYPE_LABELS.passport}</option>
                        <option value="br_number">BR 號碼</option>
                      </Select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-id-number">
                        身份證明號碼
                      </label>
                      <Input
                        id="corp-change-new-officer-id-number"
                        size="sm"
                        className="w-full"
                        value={form.newOfficerIdentificationNumber}
                        onChange={(event) =>
                          set("newOfficerIdentificationNumber", event.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="corp-change-new-officer-address">
                        地址
                      </label>
                      <Input
                        id="corp-change-new-officer-address"
                        size="sm"
                        className="w-full"
                        value={form.newOfficerAddress}
                        onChange={(event) => set("newOfficerAddress", event.target.value)}
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className={labelClass} htmlFor="corp-change-effective-date">
                    生效日期
                  </label>
                  <Input
                    id="corp-change-effective-date"
                    type="date"
                    size="sm"
                    className="w-full"
                    value={form.effectiveDate}
                    onChange={(event) => set("effectiveDate", event.target.value)}
                    required
                  />
                </div>
              </>
            )}

            {submitError && (
              <p role="alert" className="text-xs text-destructive">
                {submitError}
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                取消
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={submitting || !isValid()}>
                {submitting ? "建立中…" : "建立申請"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
