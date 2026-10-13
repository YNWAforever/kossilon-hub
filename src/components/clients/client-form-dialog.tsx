import { useEffect, useMemo, useState } from "react";
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
import { createClient, updateClient } from "@/features/clients/server-fns";
import type { ClientAssignmentOptions, ClientDetail } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ClientAssignmentOptions;
  /** Omit to create a new client; supply to edit an existing one. */
  client?: ClientDetail;
  onSaved: (clientId: string) => void;
};

type FormState = {
  companyName: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  status: "active" | "inactive";
  ownerId: string;
  teamId: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
};

function emptyForm(options: ClientAssignmentOptions): FormState {
  return {
    companyName: "",
    crNumber: "",
    brNumber: "",
    incorporationDate: "",
    annualReturnBasisDate: "",
    registeredOffice: "",
    companySecretary: "Kossilon Secretaries Ltd",
    status: "active",
    ownerId: options.owners[0]?.id ?? "",
    teamId: options.teams[0]?.id ?? "",
    contactName: "",
    contactRole: "Primary contact",
    contactEmail: "",
    contactPhone: "",
  };
}

function formFor(client: ClientDetail): FormState {
  return {
    companyName: client.companyName,
    crNumber: client.crNumber,
    brNumber: client.brNumber,
    incorporationDate: client.incorporationDate,
    annualReturnBasisDate: client.annualReturnBasisDate,
    registeredOffice: client.registeredOffice,
    companySecretary: client.companySecretary,
    status: client.status,
    ownerId: client.ownerId,
    teamId: client.teamId,
    contactName: "",
    contactRole: "Primary contact",
    contactEmail: "",
    contactPhone: "",
  };
}

const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

/** ClientWriteError fields this dialog renders an inline message for. Anything else toasts. */
const INLINE_ERROR_FIELDS = new Set(["crNumber", "brNumber", "contact"]);

export function ClientFormDialog({ open, onOpenChange, options, client, onSaved }: Props) {
  const isEdit = Boolean(client);
  const [form, setForm] = useState<FormState>(() =>
    client ? formFor(client) : emptyForm(options),
  );
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(client ? formFor(client) : emptyForm(options));
      setFieldError(null);
    }
  }, [open, client, options]);

  // `listAssignmentOptions()` only returns active users/teams, so if the company's
  // currently-assigned owner or team has since been deactivated it will not appear in
  // `options`. A <Select> whose value matches no <option> renders blank or silently falls
  // back to the browser's first option, so saving the form could silently reassign the
  // company. When editing, append a synthetic "(inactive)" option for the current owner
  // and team so the select always has a matching option and reflects the true value.
  const ownerOptions = useMemo(() => {
    if (!client || options.owners.some((owner) => owner.id === client.ownerId)) {
      return options.owners;
    }

    return [
      ...options.owners,
      { id: client.ownerId, name: `${client.ownerName}（已停用）`, teamId: null },
    ];
  }, [client, options.owners]);

  const teamOptions = useMemo(() => {
    if (!client || options.teams.some((team) => team.id === client.teamId)) {
      return options.teams;
    }

    return [...options.teams, { id: client.teamId, name: `${client.teamName}（已停用）` }];
  }, [client, options.teams]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldError(null);
    setSaving(true);

    try {
      if (client) {
        const saved = await updateClient({
          data: {
            id: client.id,
            companyName: form.companyName,
            registeredOffice: form.registeredOffice,
            status: form.status,
            ownerId: form.ownerId,
            teamId: form.teamId,
          },
        });
        toast.success("已更新客戶資料。");
        onSaved(saved.id);
      } else {
        const hasContact = form.contactName.trim().length > 0;
        const saved = await createClient({
          data: {
            companyName: form.companyName,
            crNumber: form.crNumber,
            brNumber: form.brNumber,
            incorporationDate: form.incorporationDate,
            annualReturnBasisDate: form.annualReturnBasisDate,
            registeredOffice: form.registeredOffice,
            companySecretary: form.companySecretary,
            ownerId: form.ownerId,
            teamId: form.teamId,
            contacts: hasContact
              ? [
                  {
                    name: form.contactName,
                    role: form.contactRole,
                    email: form.contactEmail.trim() || null,
                    phone: form.contactPhone.trim() || null,
                    isPrimary: true,
                  },
                ]
              : [],
          },
        });
        toast.success("已新增客戶。");
        onSaved(saved.id);
      }

      onOpenChange(false);
    } catch (error) {
      const field = (error as { field?: string }).field;
      const message = error instanceof Error ? error.message : "未能儲存客戶資料。";

      // Only these fields have somewhere to render an inline error. Anything else falls back
      // to a toast — without this the message would be swallowed entirely, because a truthy
      // `field` with no matching slot renders nothing and skips the toast.
      if (field && INLINE_ERROR_FIELDS.has(field)) {
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
          <DialogTitle>{isEdit ? "編輯客戶" : "新增客戶"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "更新公司紀錄，所有變更會記錄在公司時間線。"
              : "在客戶名冊新增公司，CR 及 BR 號碼不得重複。"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="client-name">
              公司名稱
            </label>
            <Input
              id="client-name"
              size="sm"
              className="w-full"
              value={form.companyName}
              onChange={(event) => set("companyName", event.target.value)}
              required
            />
          </div>

          {!isEdit && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="client-cr">
                  CR 號碼
                </label>
                <Input
                  id="client-cr"
                  size="sm"
                  aria-invalid={fieldError?.field === "crNumber"}
                  aria-describedby={
                    fieldError?.field === "crNumber" ? "client-cr-error" : undefined
                  }
                  className="w-full"
                  value={form.crNumber}
                  onChange={(event) => set("crNumber", event.target.value)}
                  required
                />
                {fieldError?.field === "crNumber" && (
                  <p id="client-cr-error" className="mt-1 text-xs text-destructive">
                    {fieldError.message}
                  </p>
                )}
              </div>
              <div>
                <label className={labelClass} htmlFor="client-br">
                  BR 號碼
                </label>
                <Input
                  id="client-br"
                  size="sm"
                  aria-invalid={fieldError?.field === "brNumber"}
                  aria-describedby={
                    fieldError?.field === "brNumber" ? "client-br-error" : undefined
                  }
                  className="w-full"
                  value={form.brNumber}
                  onChange={(event) => set("brNumber", event.target.value)}
                  required
                />
                {fieldError?.field === "brNumber" && (
                  <p id="client-br-error" className="mt-1 text-xs text-destructive">
                    {fieldError.message}
                  </p>
                )}
              </div>
              <div>
                <label className={labelClass} htmlFor="client-incorporated">
                  成立日期
                </label>
                <Input
                  id="client-incorporated"
                  type="date"
                  size="sm"
                  className="w-full"
                  value={form.incorporationDate}
                  onChange={(event) => set("incorporationDate", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="client-basis">
                  周年申報基準日
                </label>
                <Input
                  id="client-basis"
                  type="date"
                  size="sm"
                  className="w-full"
                  value={form.annualReturnBasisDate}
                  onChange={(event) => set("annualReturnBasisDate", event.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="client-office">
              註冊辦事處
            </label>
            <Input
              id="client-office"
              size="sm"
              className="w-full"
              value={form.registeredOffice}
              onChange={(event) => set("registeredOffice", event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="client-owner">
                負責同事
              </label>
              <Select
                id="client-owner"
                size="sm"
                className="w-full"
                value={form.ownerId}
                onChange={(event) => set("ownerId", event.target.value)}
              >
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={labelClass} htmlFor="client-team">
                團隊
              </label>
              <Select
                id="client-team"
                size="sm"
                className="w-full"
                value={form.teamId}
                onChange={(event) => set("teamId", event.target.value)}
              >
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {isEdit && (
            <div>
              <label className={labelClass} htmlFor="client-status">
                狀態
              </label>
              <Select
                id="client-status"
                size="sm"
                className="w-full"
                value={form.status}
                onChange={(event) => set("status", event.target.value as "active" | "inactive")}
              >
                <option value="active">有效</option>
                <option value="inactive">已停用</option>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                客戶只會停用而不會刪除——刪除公司會一併移除其周年申報紀錄。
              </p>
            </div>
          )}

          {!isEdit && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-xs font-medium text-foreground">主要聯絡人（選填）</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="contact-name">
                    姓名
                  </label>
                  <Input
                    id="contact-name"
                    size="sm"
                    className="w-full"
                    value={form.contactName}
                    onChange={(event) => set("contactName", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-role">
                    職位
                  </label>
                  <Input
                    id="contact-role"
                    size="sm"
                    className="w-full"
                    value={form.contactRole}
                    onChange={(event) => set("contactRole", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-email">
                    電郵
                  </label>
                  <Input
                    id="contact-email"
                    aria-invalid={fieldError?.field === "contact"}
                    aria-describedby={
                      fieldError?.field === "contact" ? "client-contact-error" : undefined
                    }
                    type="email"
                    size="sm"
                    className="w-full"
                    value={form.contactEmail}
                    onChange={(event) => set("contactEmail", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-phone">
                    電話
                  </label>
                  <Input
                    id="contact-phone"
                    aria-invalid={fieldError?.field === "contact"}
                    aria-describedby={
                      fieldError?.field === "contact" ? "client-contact-error" : undefined
                    }
                    size="sm"
                    className="w-full"
                    value={form.contactPhone}
                    onChange={(event) => set("contactPhone", event.target.value)}
                  />
                </div>
              </div>
              {fieldError?.field === "contact" && (
                <p id="client-contact-error" className="mt-2 text-xs text-destructive">
                  {fieldError.message}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? "儲存中…" : isEdit ? "儲存變更" : "新增客戶"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
