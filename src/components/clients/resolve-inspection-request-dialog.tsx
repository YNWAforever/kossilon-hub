import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveClientInspectionRequest } from "@/features/clients/server-fns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  inspectionRequestId: string;
  onSaved: () => void;
};

const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function ResolveInspectionRequestDialog({
  open,
  onOpenChange,
  companyId,
  inspectionRequestId,
  onSaved,
}: Props) {
  const [resolutionNote, setResolutionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setResolutionNote("");
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await resolveClientInspectionRequest({
        data: { companyId, inspectionRequestId, resolutionNote },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能處理查閱要求。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>處理查閱要求</DialogTitle>
          <DialogDescription>記錄如何及何時完成此要求。</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="resolve-inspection-note">
              處理備註
            </label>
            <textarea
              id="resolve-inspection-note"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
              rows={3}
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
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
              {saving ? "儲存中…" : "完成處理"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
