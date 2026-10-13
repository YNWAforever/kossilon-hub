import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
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

const CAPITAL_ERROR = "註冊資本須為大於零的整數金額。";
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

  const capitalInvalid = error === CAPITAL_ERROR;

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedCapital = form.registeredCapital.trim();
    const parsedCapital = Number.parseInt(trimmedCapital, 10);

    if (!/^\d+$/.test(trimmedCapital) || parsedCapital <= 0) {
      setError(CAPITAL_ERROR);
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
      toast.success("已開立公司註冊案件。");
      onCreated(created.id);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能開立案件。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>開始公司註冊</DialogTitle>
          <DialogDescription>追蹤新香港公司由受理至公司註冊處批核的註冊進度。</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : hasError ? (
          <p role="alert" className="text-sm text-destructive">
            未能載入負責同事或團隊資料，請稍後再試。
          </p>
        ) : owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            沒有可分配為負責同事的在職同事。請先由 Admin 啟用同事，再開立公司註冊案件。
          </p>
        ) : teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            尚未設定任何團隊。請先由 Admin 設定團隊，再開立公司註冊案件。
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intake-name-en">
                  擬用名稱（英文）
                </label>
                <Input
                  id="intake-name-en"
                  size="sm"
                  className="w-full"
                  value={form.proposedCompanyNameEn}
                  onChange={(event) => set("proposedCompanyNameEn", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-name-zh">
                  擬用名稱（中文）
                </label>
                <Input
                  id="intake-name-zh"
                  size="sm"
                  className="w-full"
                  value={form.proposedCompanyNameZh}
                  onChange={(event) => set("proposedCompanyNameZh", event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="intake-office">
                擬用註冊辦事處
              </label>
              <Input
                id="intake-office"
                size="sm"
                className="w-full"
                value={form.proposedRegisteredOffice}
                onChange={(event) => set("proposedRegisteredOffice", event.target.value)}
                required
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="intake-secretary">
                擬任公司秘書
              </label>
              <Input
                id="intake-secretary"
                size="sm"
                className="w-full"
                value={form.proposedCompanySecretary}
                onChange={(event) => set("proposedCompanySecretary", event.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intake-capital">
                  註冊資本（HKD）
                </label>
                <Input
                  id="intake-capital"
                  aria-invalid={capitalInvalid}
                  aria-describedby={capitalInvalid ? "intake-form-error" : undefined}
                  type="number"
                  min="1"
                  step="1"
                  size="sm"
                  className="w-full"
                  value={form.registeredCapital}
                  onChange={(event) => set("registeredCapital", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-nature">
                  業務性質
                </label>
                <Input
                  id="intake-nature"
                  size="sm"
                  className="w-full"
                  value={form.businessNature}
                  onChange={(event) => set("businessNature", event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="intake-owner">
                  負責同事
                </label>
                <Select
                  id="intake-owner"
                  size="sm"
                  className="w-full"
                  value={form.ownerId}
                  onChange={(event) => set("ownerId", event.target.value)}
                  required
                >
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-team">
                  團隊
                </label>
                <Select
                  id="intake-team"
                  size="sm"
                  className="w-full"
                  value={form.teamId}
                  onChange={(event) => set("teamId", event.target.value)}
                  required
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-target-date">
                  目標完成日期
                </label>
                <Input
                  id="intake-target-date"
                  type="date"
                  size="sm"
                  className="w-full"
                  value={form.targetCompletionDate}
                  onChange={(event) => set("targetCompletionDate", event.target.value)}
                  required
                />
              </div>
            </div>

            {error && (
              <p id="intake-form-error" role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={saving}>
                {saving ? "開立中…" : "開始公司註冊"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
