import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { appointClientOfficer } from "@/features/clients/server-fns";
import { IDENTIFICATION_TYPE_LABELS, OFFICER_TYPE_LABELS } from "@/features/clients/labels";
import type { IdentificationType, OfficerType } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSaved: () => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

function today(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

export function OfficerFormDialog({ open, onOpenChange, companyId, onSaved }: Props) {
  const [officerType, setOfficerType] = useState<OfficerType>("director");
  const [name, setName] = useState("");
  const [identificationType, setIdentificationType] = useState<IdentificationType | "">("");
  const [identificationNumber, setIdentificationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setOfficerType("director");
    setName("");
    setIdentificationType("");
    setIdentificationNumber("");
    setAddress("");
    setAppointmentDate(today());
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await appointClientOfficer({
        data: {
          companyId,
          officerType,
          name,
          identificationType: identificationType || null,
          identificationNumber: identificationNumber.trim() || null,
          address: address.trim() || null,
          appointmentDate,
        },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能委任高級人員。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>委任高級人員</DialogTitle>
          <DialogDescription>
            委任新的公司秘書或指定代表後，會自動取代現任的同類人員。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="officer-form-type">
              類別
            </label>
            <select
              id="officer-form-type"
              className={inputClass}
              value={officerType}
              onChange={(event) => setOfficerType(event.target.value as OfficerType)}
            >
              <option value="director">{OFFICER_TYPE_LABELS.director}</option>
              <option value="secretary">{OFFICER_TYPE_LABELS.secretary}</option>
              <option value="designated_representative">
                {OFFICER_TYPE_LABELS.designated_representative}
              </option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="officer-form-name">
              姓名
            </label>
            <input
              id="officer-form-name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="officer-form-id-type">
                身份證明類別
              </label>
              <select
                id="officer-form-id-type"
                className={inputClass}
                value={identificationType}
                onChange={(event) =>
                  setIdentificationType(event.target.value as IdentificationType | "")
                }
              >
                <option value="">未有紀錄</option>
                <option value="hkid">{IDENTIFICATION_TYPE_LABELS.hkid}</option>
                <option value="passport">{IDENTIFICATION_TYPE_LABELS.passport}</option>
                <option value="br_number">{IDENTIFICATION_TYPE_LABELS.br_number}</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="officer-form-id-number">
                身份證明號碼
              </label>
              <input
                id="officer-form-id-number"
                className={inputClass}
                value={identificationNumber}
                onChange={(event) => setIdentificationNumber(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="officer-form-address">
              地址
            </label>
            <input
              id="officer-form-address"
              className={inputClass}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="officer-form-appointment-date">
              委任日期
            </label>
            <input
              id="officer-form-appointment-date"
              type="date"
              className={inputClass}
              value={appointmentDate}
              onChange={(event) => setAppointmentDate(event.target.value)}
              required
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "儲存中…" : "委任高級人員"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
