import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient, listClientAssignmentOptions } from "@/features/clients/server-fns";
import type { ClientAssignmentOptions } from "@/features/clients/types";
import type { Enquiry } from "@/lib/mock-data";
import { UserPlus } from "lucide-react";

type Props = {
  enquiry: Enquiry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

const EMPTY_OPTIONS: ClientAssignmentOptions = { owners: [], teams: [], packages: [] };

export function ConvertToClientDialog({ enquiry, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [options, setOptions] = useState<ClientAssignmentOptions>(EMPTY_OPTIONS);
  const [companyName, setCompanyName] = useState("");
  const [crNumber, setCrNumber] = useState("");
  const [brNumber, setBrNumber] = useState("");
  const [incorporationDate, setIncorporationDate] = useState("");
  const [basisDate, setBasisDate] = useState("");
  const [registeredOffice, setRegisteredOffice] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    listClientAssignmentOptions()
      .then((loaded) => {
        if (cancelled) return;
        setOptions(loaded);
        setOwnerId((current) => current || loaded.owners[0]?.id || "");
        setTeamId((current) => current || loaded.teams[0]?.id || "");
        setPackageId((current) => current || loaded.packages[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) toast.error("Unable to load owners and packages.");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !enquiry) return;

    setCompanyName(`${enquiry.contactName.split(" ")[0]} Company Ltd`);
    setCrNumber("");
    setBrNumber("");
    setIncorporationDate("");
    setBasisDate("");
    setRegisteredOffice("");
    setFieldError(null);
  }, [open, enquiry]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!enquiry) return;

    setFieldError(null);
    setSaving(true);

    try {
      const created = await createClient({
        data: {
          companyName,
          crNumber,
          brNumber,
          incorporationDate,
          annualReturnBasisDate: basisDate,
          registeredOffice,
          companySecretary: "Kossilon Secretaries Ltd",
          ownerId,
          teamId,
          packageId: packageId || null,
          contacts: [
            {
              name: enquiry.contactName,
              role: "Primary contact",
              email: null,
              phone: enquiry.phone,
              isPrimary: true,
            },
          ],
        },
      });

      toast.success(`${companyName} added to the register.`);
      onOpenChange(false);
      await navigate({ to: "/clients/$id", params: { id: created.id } });
    } catch (error) {
      const field = (error as { field?: string }).field;
      const message = error instanceof Error ? error.message : "Unable to convert the enquiry.";

      if (field) {
        setFieldError({ field, message });
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" /> Convert enquiry to client
          </DialogTitle>
          <DialogDescription>
            {enquiry
              ? `Creates a company record from the enquiry with ${enquiry.contactName} (${enquiry.phone}).`
              : "Select an enquiry to convert."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="convert-name">
              Company name
            </label>
            <input
              id="convert-name"
              className={inputClass}
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="convert-cr">
                CR number
              </label>
              <input
                id="convert-cr"
                className={inputClass}
                value={crNumber}
                onChange={(event) => setCrNumber(event.target.value)}
                required
              />
              {fieldError?.field === "crNumber" && (
                <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-br">
                BR number
              </label>
              <input
                id="convert-br"
                className={inputClass}
                value={brNumber}
                onChange={(event) => setBrNumber(event.target.value)}
                required
              />
              {fieldError?.field === "brNumber" && (
                <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-incorporated">
                Incorporation date
              </label>
              <input
                id="convert-incorporated"
                type="date"
                className={inputClass}
                value={incorporationDate}
                onChange={(event) => setIncorporationDate(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-basis">
                Annual return basis date
              </label>
              <input
                id="convert-basis"
                type="date"
                className={inputClass}
                value={basisDate}
                onChange={(event) => setBasisDate(event.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="convert-office">
              Registered office
            </label>
            <input
              id="convert-office"
              className={inputClass}
              value={registeredOffice}
              onChange={(event) => setRegisteredOffice(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="convert-owner">
                Owner
              </label>
              <select
                id="convert-owner"
                className={inputClass}
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                {options.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-team">
                Team
              </label>
              <select
                id="convert-team"
                className={inputClass}
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
              >
                {options.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-package">
                Package
              </label>
              <select
                id="convert-package"
                className={inputClass}
                value={packageId}
                onChange={(event) => setPackageId(event.target.value)}
              >
                {options.packages.map((servicePackage) => (
                  <option key={servicePackage.id} value={servicePackage.id}>
                    {servicePackage.name} — HKD {servicePackage.defaultFee.toLocaleString()}
                  </option>
                ))}
              </select>
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
              disabled={saving || !enquiry}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Converting…" : "Convert to client"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
