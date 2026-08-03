import { useEffect, useState } from "react";
import { toast } from "sonner";
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

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!email.trim() && !phone.trim()) {
      setError("Provide an email or a phone number.");
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
        toast.success("Contact updated.");
      } else {
        await addClientContact({ data: payload });
        toast.success("Contact added.");
      }

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            A contact needs at least an email or a phone number.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="contact-form-name">
                Name
              </label>
              <input
                id="contact-form-name"
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-role">
                Role
              </label>
              <input
                id="contact-form-role"
                className={inputClass}
                value={role}
                onChange={(event) => setRole(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-email">
                Email
              </label>
              <input
                id="contact-form-email"
                type="email"
                className={inputClass}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-phone">
                Phone
              </label>
              <input
                id="contact-form-phone"
                className={inputClass}
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
            Primary contact
          </label>
          <p className="text-xs text-muted-foreground">
            Marking this contact primary demotes the company&apos;s current primary contact.
          </p>

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
              {saving ? "Saving…" : "Save contact"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
