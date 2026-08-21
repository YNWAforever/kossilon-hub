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

const today = () => new Date().toISOString().slice(0, 10);

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
      setError(caught instanceof Error ? caught.message : "Unable to appoint the officer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Appoint officer</DialogTitle>
          <DialogDescription>
            Appointing a new secretary automatically supersedes the current one.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="officer-form-type">
              Type
            </label>
            <select
              id="officer-form-type"
              className={inputClass}
              value={officerType}
              onChange={(event) => setOfficerType(event.target.value as OfficerType)}
            >
              <option value="director">Director</option>
              <option value="secretary">Secretary</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="officer-form-name">
              Name
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
                Identification type
              </label>
              <select
                id="officer-form-id-type"
                className={inputClass}
                value={identificationType}
                onChange={(event) =>
                  setIdentificationType(event.target.value as IdentificationType | "")
                }
              >
                <option value="">Not on file</option>
                <option value="hkid">HKID</option>
                <option value="passport">Passport</option>
                <option value="br_number">BR number (corporate)</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="officer-form-id-number">
                Identification number
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
              Address
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
              Appointment date
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Appoint officer"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
