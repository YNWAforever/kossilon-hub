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
import { recordClientInspectionRequest } from "@/features/clients/server-fns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSaved: () => void;
};

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
      setError(caught instanceof Error ? caught.message : "未能記錄查閱要求。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>記錄查閱要求</DialogTitle>
          <DialogDescription>記錄查閱此公司重要控制人登記冊的要求。</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="inspection-form-requester">
              要求人名稱
            </label>
            <Input
              id="inspection-form-requester"
              size="sm"
              className="w-full"
              value={requesterName}
              onChange={(event) => setRequesterName(event.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="inspection-form-authority">
              要求人身分／機構
            </label>
            <Input
              id="inspection-form-authority"
              size="sm"
              className="w-full"
              value={requesterAuthority}
              onChange={(event) => setRequesterAuthority(event.target.value)}
              placeholder="例如：公司註冊處"
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="inspection-form-date">
              要求日期
            </label>
            <Input
              id="inspection-form-date"
              type="date"
              size="sm"
              className="w-full"
              value={requestDate}
              onChange={(event) => setRequestDate(event.target.value)}
              required
            />
          </div>

          {error && (
            <p id="inspection-form-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? "儲存中…" : "記錄查閱要求"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
