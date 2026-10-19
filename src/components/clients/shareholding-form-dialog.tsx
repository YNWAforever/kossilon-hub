import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
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

const SHARES_ERROR = "請輸入大於零的整數股數。";
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

  const sharesInvalid = error === SHARES_ERROR;

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedShares = numberOfShares.trim();
    const parsedShares = Number.parseInt(trimmedShares, 10);

    if (!/^\d+$/.test(trimmedShares) || parsedShares <= 0) {
      setError(SHARES_ERROR);
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
      setError(caught instanceof Error ? caught.message : "未能記錄股權。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>記錄股權</DialogTitle>
          <DialogDescription>在此公司的成員登記冊記錄一名股東。</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="shareholding-form-name">
              股東名稱
            </label>
            <Input
              id="shareholding-form-name"
              size="sm"
              className="w-full"
              value={shareholderName}
              onChange={(event) => setShareholderName(event.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="shareholding-form-address">
              地址
            </label>
            <Input
              id="shareholding-form-address"
              size="sm"
              className="w-full"
              value={shareholderAddress}
              onChange={(event) => setShareholderAddress(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="shareholding-form-class">
                股份類別
              </label>
              <Input
                id="shareholding-form-class"
                size="sm"
                className="w-full"
                value={shareClass}
                onChange={(event) => setShareClass(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="shareholding-form-number">
                股數
              </label>
              <Input
                id="shareholding-form-number"
                aria-invalid={sharesInvalid}
                aria-describedby={sharesInvalid ? "shareholding-form-error" : undefined}
                type="number"
                min="1"
                step="1"
                size="sm"
                className="w-full"
                value={numberOfShares}
                onChange={(event) => setNumberOfShares(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="shareholding-form-date">
                配發日期
              </label>
              <Input
                id="shareholding-form-date"
                type="date"
                size="sm"
                className="w-full"
                value={allotmentDate}
                onChange={(event) => setAllotmentDate(event.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <p id="shareholding-form-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? "儲存中…" : "記錄股權"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
