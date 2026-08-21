import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordClientInspectionRequest } from "@/features/clients/server-fns";

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

export function InspectionRequestFormDialog({ open, onOpenChange, companyId, onSaved }: Props) {
  const [requesterName, setRequesterName] = useState("");
  const [requesterAuthority, setRequesterAuthority] = useState("");
  const [requestDate, setRequestDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setRequesterName("");
    setRequesterAuthority("");
    setRequestDate(today());
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await recordClientInspectionRequest({
        data: { companyId, requesterName, requesterAuthority, requestDate },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record inspection request</DialogTitle>
          <DialogDescription>
            Log a request to inspect this company's significant controllers register.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="inspection-form-requester">
              Requester name
            </label>
            <input
              id="inspection-form-requester"
              className={inputClass}
              value={requesterName}
              onChange={(event) => setRequesterName(event.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="inspection-form-authority">
              Requester authority
            </label>
            <input
              id="inspection-form-authority"
              className={inputClass}
              value={requesterAuthority}
              onChange={(event) => setRequesterAuthority(event.target.value)}
              placeholder="e.g. Companies Registry"
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="inspection-form-date">
              Request date
            </label>
            <input
              id="inspection-form-date"
              type="date"
              className={inputClass}
              value={requestDate}
              onChange={(event) => setRequestDate(event.target.value)}
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
              {saving ? "Saving…" : "Record request"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
