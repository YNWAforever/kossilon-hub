import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordClientShareholding } from "@/features/clients/server-fns";

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

export function ShareholdingFormDialog({ open, onOpenChange, companyId, onSaved }: Props) {
  const [shareholderName, setShareholderName] = useState("");
  const [shareholderAddress, setShareholderAddress] = useState("");
  const [shareClass, setShareClass] = useState("Ordinary");
  const [numberOfShares, setNumberOfShares] = useState("");
  const [allotmentDate, setAllotmentDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setShareholderName("");
    setShareholderAddress("");
    setShareClass("Ordinary");
    setNumberOfShares("");
    setAllotmentDate(today());
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedShares = numberOfShares.trim();
    const parsedShares = Number.parseInt(trimmedShares, 10);

    if (!/^\d+$/.test(trimmedShares) || parsedShares <= 0) {
      setError("Enter a whole number of shares greater than zero.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      await recordClientShareholding({
        data: {
          companyId,
          shareholderName,
          shareholderAddress: shareholderAddress.trim() || null,
          shareClass,
          numberOfShares: parsedShares,
          allotmentDate,
        },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the shareholding.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record shareholding</DialogTitle>
          <DialogDescription>Record a member of this company's share register.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="shareholding-form-name">
              Shareholder name
            </label>
            <input
              id="shareholding-form-name"
              className={inputClass}
              value={shareholderName}
              onChange={(event) => setShareholderName(event.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="shareholding-form-address">
              Address
            </label>
            <input
              id="shareholding-form-address"
              className={inputClass}
              value={shareholderAddress}
              onChange={(event) => setShareholderAddress(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="shareholding-form-class">
                Share class
              </label>
              <input
                id="shareholding-form-class"
                className={inputClass}
                value={shareClass}
                onChange={(event) => setShareClass(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="shareholding-form-number">
                Number of shares
              </label>
              <input
                id="shareholding-form-number"
                type="number"
                min="1"
                step="1"
                className={inputClass}
                value={numberOfShares}
                onChange={(event) => setNumberOfShares(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="shareholding-form-date">
                Allotment date
              </label>
              <input
                id="shareholding-form-date"
                type="date"
                className={inputClass}
                value={allotmentDate}
                onChange={(event) => setAllotmentDate(event.target.value)}
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
              {saving ? "Saving…" : "Record shareholding"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
