import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { teamMembers, type Company, type Enquiry } from "@/lib/mock-data";
import { convertEnquiry, type ConvertFormData } from "@/lib/clients-store";
import { SERVICE_TYPES } from "@/lib/templates";
import { UserPlus } from "lucide-react";

type Props = {
  enquiry: Enquiry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted: (company: Company) => void;
};

export function ConvertToClientDialog({ enquiry, open, onOpenChange, onConverted }: Props) {
  const defaultServiceType =
    enquiry?.intent === "New Incorporation"
      ? "Incorporation — HK Ltd"
      : enquiry?.intent === "Change of Director"
        ? "Change of Director"
        : enquiry?.intent === "Deregistration"
          ? "Deregistration"
          : "Annual Return — Private Ltd";

  const [form, setForm] = useState<ConvertFormData>({
    companyName: enquiry ? `${enquiry.contactName.split(" ")[0]} Company Ltd` : "",
    brNumber: "",
    crNumber: "",
    package: "Standard",
    ownerId: enquiry?.assignedTo ?? teamMembers[0].id,
    address: "",
    serviceType: defaultServiceType,
    note: "",
  });

  // Reset form when opening for a new enquiry
  const [lastEnquiryId, setLastEnquiryId] = useState<string | null>(null);
  if (enquiry && enquiry.id !== lastEnquiryId) {
    setLastEnquiryId(enquiry.id);
    setForm({
      companyName: `${enquiry.contactName.split(" ")[0]} Company Ltd`,
      brNumber: "",
      crNumber: "",
      package: "Standard",
      ownerId: enquiry.assignedTo ?? teamMembers[0].id,
      address: "",
      serviceType: defaultServiceType,
      note: "",
    });
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!enquiry || !form.companyName.trim()) return;
    const company = convertEnquiry(enquiry, form);
    onConverted(company);
    onOpenChange(false);
  };

  const set = <K extends keyof ConvertFormData>(k: K, v: ConvertFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <UserPlus className="h-4 w-4 text-primary" /> Convert enquiry to client
          </DialogTitle>
          <DialogDescription>
            {enquiry
              ? `Create a new client company from the conversation with ${enquiry.contactName}. An initial timeline entry and owner will be recorded.`
              : "Select an enquiry to convert."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Company name">
            <input
              required
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              className={inputCls}
              placeholder="Acme HK Ltd"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="BR number (optional)">
              <input
                value={form.brNumber}
                onChange={(e) => set("brNumber", e.target.value)}
                className={inputCls}
                placeholder="60000000"
              />
            </Field>
            <Field label="CR number (optional)">
              <input
                value={form.crNumber}
                onChange={(e) => set("crNumber", e.target.value)}
                className={inputCls}
                placeholder="1200000"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Service package">
              <select
                value={form.package}
                onChange={(e) => set("package", e.target.value as ConvertFormData["package"])}
                className={inputCls}
              >
                <option value="Basic">Basic — HKD 2,800</option>
                <option value="Standard">Standard — HKD 3,800</option>
                <option value="Premium">Premium — HKD 5,200</option>
              </select>
            </Field>
            <Field label="Service type">
              <select
                value={form.serviceType}
                onChange={(e) => set("serviceType", e.target.value)}
                className={inputCls}
              >
                {SERVICE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Assigned owner">
            <select
              value={form.ownerId}
              onChange={(e) => set("ownerId", e.target.value)}
              className={inputCls}
            >
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role} · {m.team}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Registered address (optional)">
            <input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              className={inputCls}
              placeholder="Suite 1201, 12/F, Central, Hong Kong"
            />
          </Field>

          <Field label="Onboarding note (optional)">
            <textarea
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              rows={2}
              className={inputCls + " resize-none"}
              placeholder="Anything the assigned owner should know…"
            />
          </Field>

          <DialogFooter className="pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create client
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
