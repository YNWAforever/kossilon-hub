import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  recordClientController,
  updateClientControllerParticulars,
} from "@/features/clients/server-fns";
import type {
  ControlBasis,
  IdentificationType,
  SignificantController,
} from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Omit to record a new controller; supply to edit an existing one's particulars. */
  controller?: SignificantController;
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

const CONTROL_BASIS_OPTIONS: { value: ControlBasis; label: string }[] = [
  { value: "shares_over_25pct", label: "Holds more than 25% of shares" },
  { value: "votes_over_25pct", label: "Holds more than 25% of voting rights" },
  { value: "board_appointment_right", label: "Right to appoint/remove a majority of the board" },
  { value: "significant_influence", label: "Exercises significant influence or control" },
];

export function ControllerFormDialog({
  open,
  onOpenChange,
  companyId,
  controller,
  onSaved,
}: Props) {
  const [controllerName, setControllerName] = useState("");
  const [identificationType, setIdentificationType] = useState<IdentificationType | "">("");
  const [identificationNumber, setIdentificationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [controlBases, setControlBases] = useState<ControlBasis[]>([]);
  const [registeredDate, setRegisteredDate] = useState(today());
  const [registerUpdateDueDate, setRegisterUpdateDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setControllerName(controller?.controllerName ?? "");
    setIdentificationType(controller?.identificationType ?? "");
    setIdentificationNumber(controller?.identificationNumber ?? "");
    setAddress(controller?.address ?? "");
    setControlBases(controller?.controlBases ?? []);
    setRegisteredDate(controller?.registeredDate ?? today());
    setRegisterUpdateDueDate(controller?.registerUpdateDueDate ?? "");
    setError(null);
  }, [open, controller]);

  function toggleBasis(basis: ControlBasis) {
    setControlBases((current) =>
      current.includes(basis) ? current.filter((value) => value !== basis) : [...current, basis],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (controlBases.length === 0) {
      setError("Select at least one control basis.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      if (controller) {
        await updateClientControllerParticulars({
          data: {
            companyId,
            controllerId: controller.id,
            address: address.trim() || null,
            controlBases,
            registerUpdateDueDate: registerUpdateDueDate || null,
          },
        });
      } else {
        await recordClientController({
          data: {
            companyId,
            controllerName,
            identificationType: identificationType || null,
            identificationNumber: identificationNumber.trim() || null,
            address: address.trim() || null,
            controlBases,
            registeredDate,
            registerUpdateDueDate: registerUpdateDueDate || null,
          },
        });
      }

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the controller.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {controller ? "Edit controller particulars" : "Record significant controller"}
          </DialogTitle>
          <DialogDescription>
            A controller must satisfy at least one of the four control tests.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {!controller ? (
            <div>
              <label className={labelClass} htmlFor="controller-form-name">
                Controller name
              </label>
              <input
                id="controller-form-name"
                className={inputClass}
                value={controllerName}
                onChange={(event) => setControllerName(event.target.value)}
                required
              />
            </div>
          ) : null}

          <div>
            <p className={labelClass}>Control bases</p>
            <div className="mt-1 space-y-1">
              {CONTROL_BASIS_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={controlBases.includes(option.value)}
                    onChange={() => toggleBasis(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          {!controller ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="controller-form-id-type">
                  Identification type
                </label>
                <select
                  id="controller-form-id-type"
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
                <label className={labelClass} htmlFor="controller-form-id-number">
                  Identification number
                </label>
                <input
                  id="controller-form-id-number"
                  className={inputClass}
                  value={identificationNumber}
                  onChange={(event) => setIdentificationNumber(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div>
            <label className={labelClass} htmlFor="controller-form-address">
              Address
            </label>
            <input
              id="controller-form-address"
              className={inputClass}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {!controller ? (
              <div>
                <label className={labelClass} htmlFor="controller-form-registered-date">
                  Registered date
                </label>
                <input
                  id="controller-form-registered-date"
                  type="date"
                  className={inputClass}
                  value={registeredDate}
                  onChange={(event) => setRegisteredDate(event.target.value)}
                  required
                />
              </div>
            ) : null}
            <div>
              <label className={labelClass} htmlFor="controller-form-due-date">
                Register update due date
              </label>
              <input
                id="controller-form-due-date"
                type="date"
                className={inputClass}
                value={registerUpdateDueDate}
                onChange={(event) => setRegisterUpdateDueDate(event.target.value)}
              />
            </div>
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
              {saving ? "Saving…" : controller ? "Save particulars" : "Record controller"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
