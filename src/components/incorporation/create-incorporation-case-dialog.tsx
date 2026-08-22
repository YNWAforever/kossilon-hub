import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createIncorporationCase } from "@/features/incorporation/server-fns";
import type { ClientAssignmentOptions } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owners: ClientAssignmentOptions["owners"];
  teams: ClientAssignmentOptions["teams"];
  isLoading: boolean;
  hasError: boolean;
  onCreated: (caseId: string) => void;
};

type FormState = {
  proposedCompanyNameEn: string;
  proposedCompanyNameZh: string;
  proposedRegisteredOffice: string;
  proposedCompanySecretary: string;
  registeredCapital: string;
  businessNature: string;
  ownerId: string;
  teamId: string;
  targetCompletionDate: string;
};

function emptyForm(
  owners: ClientAssignmentOptions["owners"],
  teams: ClientAssignmentOptions["teams"],
): FormState {
  return {
    proposedCompanyNameEn: "",
    proposedCompanyNameZh: "",
    proposedRegisteredOffice: "",
    proposedCompanySecretary: "Kossilon Secretaries Ltd",
    registeredCapital: "10000",
    businessNature: "",
    ownerId: owners[0]?.id ?? "",
    teamId: teams[0]?.id ?? "",
    targetCompletionDate: "",
  };
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function CreateIncorporationCaseDialog({
  open,
  onOpenChange,
  owners,
  teams,
  isLoading,
  hasError,
  onCreated,
}: Props) {
  const [form, setForm] = useState<FormState>(() => emptyForm(owners, teams));
  const [error, setError] = useState<string | null>(null);
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
    setForm(emptyForm(owners, teams));
    setError(null);
    initializedRef.current = true;
  }, [open, isLoading, owners, teams]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedCapital = form.registeredCapital.trim();
    const parsedCapital = Number.parseInt(trimmedCapital, 10);

    if (!/^\d+$/.test(trimmedCapital) || parsedCapital <= 0) {
      setError("Enter a whole number of dollars greater than zero for registered capital.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const created = await createIncorporationCase({
        data: {
          proposedCompanyNameEn: form.proposedCompanyNameEn,
          proposedCompanyNameZh: form.proposedCompanyNameZh.trim() || null,
          proposedRegisteredOffice: form.proposedRegisteredOffice,
          proposedCompanySecretary: form.proposedCompanySecretary,
          registeredCapital: parsedCapital,
          businessNature: form.businessNature,
          ownerId: form.ownerId,
          teamId: form.teamId,
          targetCompletionDate: form.targetCompletionDate,
        },
      });
      toast.success("Incorporation case created.");
      onCreated(created.id);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the case.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start incorporation</DialogTitle>
          <DialogDescription>
            Track a new HK company's incorporation from intake through Companies Registry approval.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hasError ? (
          <p role="alert" className="text-sm text-destructive">
            Unable to load owner or team data. Try again shortly.
          </p>
        ) : owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active staff members are available to assign as owner. Ask an Admin to activate one
            before starting an incorporation case.
          </p>
        ) : teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No teams are configured. Ask an Admin to configure one before starting an incorporation
            case.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intake-name-en">
                  Proposed name (English)
                </label>
                <input
                  id="intake-name-en"
                  className={inputClass}
                  value={form.proposedCompanyNameEn}
                  onChange={(event) => set("proposedCompanyNameEn", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-name-zh">
                  Proposed name (Chinese)
                </label>
                <input
                  id="intake-name-zh"
                  className={inputClass}
                  value={form.proposedCompanyNameZh}
                  onChange={(event) => set("proposedCompanyNameZh", event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="intake-office">
                Proposed registered office
              </label>
              <input
                id="intake-office"
                className={inputClass}
                value={form.proposedRegisteredOffice}
                onChange={(event) => set("proposedRegisteredOffice", event.target.value)}
                required
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="intake-secretary">
                Proposed company secretary
              </label>
              <input
                id="intake-secretary"
                className={inputClass}
                value={form.proposedCompanySecretary}
                onChange={(event) => set("proposedCompanySecretary", event.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intake-capital">
                  Registered capital (HKD)
                </label>
                <input
                  id="intake-capital"
                  type="number"
                  min="1"
                  step="1"
                  className={inputClass}
                  value={form.registeredCapital}
                  onChange={(event) => set("registeredCapital", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-nature">
                  Business nature
                </label>
                <input
                  id="intake-nature"
                  className={inputClass}
                  value={form.businessNature}
                  onChange={(event) => set("businessNature", event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="intake-owner">
                  Owner
                </label>
                <select
                  id="intake-owner"
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
              <div>
                <label className={labelClass} htmlFor="intake-team">
                  Team
                </label>
                <select
                  id="intake-team"
                  className={inputClass}
                  value={form.teamId}
                  onChange={(event) => set("teamId", event.target.value)}
                  required
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-target-date">
                  Target completion date
                </label>
                <input
                  id="intake-target-date"
                  type="date"
                  className={inputClass}
                  value={form.targetCompletionDate}
                  onChange={(event) => set("targetCompletionDate", event.target.value)}
                  required
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
                {saving ? "Creating…" : "Start incorporation"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
