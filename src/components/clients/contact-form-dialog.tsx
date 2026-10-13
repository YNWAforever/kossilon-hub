import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { addClientContact, updateClientContact } from "@/features/clients/server-fns";
import type { CompanyContact } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Omit to add a new contact; supply to edit an existing one. */
  contact?: CompanyContact;
  onSaved: () => void;
};

/** Shown by this dialog and by the server's reachability constraint (ClientWriteError "contact"). */
const REACHABILITY_MESSAGE = "請提供電郵地址或電話號碼。";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function ContactFormDialog({ open, onOpenChange, companyId, contact, onSaved }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setName(contact?.name ?? "");
    setRole(contact?.role ?? "Primary contact");
    setEmail(contact?.email ?? "");
    setPhone(contact?.phone ?? "");
    setIsPrimary(contact?.isPrimary ?? false);
    setError(null);
  }, [open, contact]);

  // The missing-email-and-phone message belongs to those two fields; anything else is form-level.
  const reachabilityError = error === REACHABILITY_MESSAGE;

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!email.trim() && !phone.trim()) {
      setError(REACHABILITY_MESSAGE);
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const payload = {
        companyId,
        name,
        role,
        email: email.trim() || null,
        phone: phone.trim() || null,
        isPrimary,
      };

      if (contact) {
        await updateClientContact({ data: { ...payload, contactId: contact.id } });
        toast.success("已更新聯絡人。");
      } else {
        await addClientContact({ data: payload });
        toast.success("已新增聯絡人。");
      }

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能儲存聯絡人。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "編輯聯絡人" : "新增聯絡人"}</DialogTitle>
          <DialogDescription>聯絡人須至少提供電郵地址或電話號碼。</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="contact-form-name">
                姓名
              </label>
              <Input
                id="contact-form-name"
                size="sm"
                className="w-full"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-role">
                職位
              </label>
              <Input
                id="contact-form-role"
                size="sm"
                className="w-full"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-email">
                電郵
              </label>
              <Input
                id="contact-form-email"
                aria-invalid={reachabilityError}
                aria-describedby={reachabilityError ? "contact-form-error" : undefined}
                type="email"
                size="sm"
                className="w-full"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-phone">
                電話
              </label>
              <Input
                id="contact-form-phone"
                aria-invalid={reachabilityError}
                aria-describedby={reachabilityError ? "contact-form-error" : undefined}
                size="sm"
                className="w-full"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(event) => setIsPrimary(event.target.checked)}
            />
            主要聯絡人
          </label>
          <p className="text-xs text-muted-foreground">
            設為主要聯絡人後，公司現有的主要聯絡人會改為一般聯絡人。
          </p>

          {error && (
            <p id="contact-form-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? "儲存中…" : "儲存聯絡人"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
