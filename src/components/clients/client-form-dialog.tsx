import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  packageId: string;
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
    packageId: options.packages[0]?.id ?? "",
    contactName: "",
    contactRole: "Primary contact",
    contactEmail: "",
    contactPhone: "",
  };
}

function formFor(client: ClientDetail, options: ClientAssignmentOptions): FormState {
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
    packageId: client.packageId ?? options.packages[0]?.id ?? "",
    contactName: "",
    contactRole: "Primary contact",
    contactEmail: "",
    contactPhone: "",
  };
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function ClientFormDialog({ open, onOpenChange, options, client, onSaved }: Props) {
  const isEdit = Boolean(client);
  const [form, setForm] = useState<FormState>(() =>
    client ? formFor(client, options) : emptyForm(options),
  );
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(client ? formFor(client, options) : emptyForm(options));
      setFieldError(null);
    }
  }, [open, client, options]);

  // `listAssignmentOptions()` only returns active users/teams, so if the company's
  // currently-assigned owner or team has since been deactivated it will not appear in
  // `options`. A <select> whose value matches no <option> renders blank or silently falls
  // back to the browser's first option, so saving the form could silently reassign the
  // company. When editing, append a synthetic "(inactive)" option for the current owner
  // and team so the select always has a matching option and reflects the true value.
  const ownerOptions = useMemo(() => {
    if (!client || options.owners.some((owner) => owner.id === client.ownerId)) {
      return options.owners;
    }

    return [
      ...options.owners,
      { id: client.ownerId, name: `${client.ownerName} (inactive)`, teamId: null },
    ];
  }, [client, options.owners]);

  const teamOptions = useMemo(() => {
    if (!client || options.teams.some((team) => team.id === client.teamId)) {
      return options.teams;
    }

    return [...options.teams, { id: client.teamId, name: `${client.teamName} (inactive)` }];
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
            companySecretary: form.companySecretary,
            status: form.status,
            ownerId: form.ownerId,
            teamId: form.teamId,
            packageId: form.packageId || null,
          },
        });
        toast.success("Client updated.");
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
            packageId: form.packageId || null,
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
        toast.success("Client added.");
        onSaved(saved.id);
      }

      onOpenChange(false);
    } catch (error) {
      const field = (error as { field?: string }).field;
      const message = error instanceof Error ? error.message : "Unable to save the client.";

      if (field) {
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
          <DialogTitle>{isEdit ? "Edit client" : "Add client"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the company record. Changes are recorded on the company timeline."
              : "Create a company in the register. CR and BR numbers must be unique."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="client-name">
              Company name
            </label>
            <input
              id="client-name"
              className={inputClass}
              value={form.companyName}
              onChange={(event) => set("companyName", event.target.value)}
              required
            />
          </div>

          {!isEdit && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="client-cr">
                  CR number
                </label>
                <input
                  id="client-cr"
                  className={inputClass}
                  value={form.crNumber}
                  onChange={(event) => set("crNumber", event.target.value)}
                  required
                />
                {fieldError?.field === "crNumber" && (
                  <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
                )}
              </div>
              <div>
                <label className={labelClass} htmlFor="client-br">
                  BR number
                </label>
                <input
                  id="client-br"
                  className={inputClass}
                  value={form.brNumber}
                  onChange={(event) => set("brNumber", event.target.value)}
                  required
                />
                {fieldError?.field === "brNumber" && (
                  <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
                )}
              </div>
              <div>
                <label className={labelClass} htmlFor="client-incorporated">
                  Incorporation date
                </label>
                <input
                  id="client-incorporated"
                  type="date"
                  className={inputClass}
                  value={form.incorporationDate}
                  onChange={(event) => set("incorporationDate", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="client-basis">
                  Annual return basis date
                </label>
                <input
                  id="client-basis"
                  type="date"
                  className={inputClass}
                  value={form.annualReturnBasisDate}
                  onChange={(event) => set("annualReturnBasisDate", event.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="client-office">
              Registered office
            </label>
            <input
              id="client-office"
              className={inputClass}
              value={form.registeredOffice}
              onChange={(event) => set("registeredOffice", event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="client-owner">
                Owner
              </label>
              <select
                id="client-owner"
                className={inputClass}
                value={form.ownerId}
                onChange={(event) => set("ownerId", event.target.value)}
              >
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="client-team">
                Team
              </label>
              <select
                id="client-team"
                className={inputClass}
                value={form.teamId}
                onChange={(event) => set("teamId", event.target.value)}
              >
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="client-package">
                Package
              </label>
              <select
                id="client-package"
                className={inputClass}
                value={form.packageId}
                onChange={(event) => set("packageId", event.target.value)}
              >
                {options.packages.map((servicePackage) => (
                  <option key={servicePackage.id} value={servicePackage.id}>
                    {servicePackage.name} — HKD {servicePackage.defaultFee.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isEdit && (
            <div>
              <label className={labelClass} htmlFor="client-status">
                Status
              </label>
              <select
                id="client-status"
                className={inputClass}
                value={form.status}
                onChange={(event) => set("status", event.target.value as "active" | "inactive")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Clients are deactivated, never deleted — deleting a company would remove its annual
                return history.
              </p>
            </div>
          )}

          {!isEdit && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-xs font-medium text-foreground">Primary contact (optional)</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="contact-name">
                    Name
                  </label>
                  <input
                    id="contact-name"
                    className={inputClass}
                    value={form.contactName}
                    onChange={(event) => set("contactName", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-role">
                    Role
                  </label>
                  <input
                    id="contact-role"
                    className={inputClass}
                    value={form.contactRole}
                    onChange={(event) => set("contactRole", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-email">
                    Email
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    className={inputClass}
                    value={form.contactEmail}
                    onChange={(event) => set("contactEmail", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-phone">
                    Phone
                  </label>
                  <input
                    id="contact-phone"
                    className={inputClass}
                    value={form.contactPhone}
                    onChange={(event) => set("contactPhone", event.target.value)}
                  />
                </div>
              </div>
              {fieldError?.field === "contact" && (
                <p className="mt-2 text-xs text-destructive">{fieldError.message}</p>
              )}
            </div>
          )}

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
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add client"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
