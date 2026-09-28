import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { CompanyContact } from "../types";
import { verifyClientContactPhone } from "../contact-verification-server-fns";

const e164 = /^\+[1-9]\d{7,14}$/;
function suggestedE164(phone: string | null): string {
  const compact = (phone ?? "").replace(/[\s()-]/g, "");
  return e164.test(compact) ? compact : "";
}

export function ContactPhoneVerification({
  contact,
  companyId,
  onVerified,
}: {
  contact: CompanyContact;
  companyId: string;
  onVerified(): void;
}) {
  const [phoneE164, setPhoneE164] = useState(contact.phoneE164 ?? suggestedE164(contact.phone));
  const [language, setLanguage] = useState<"en" | "zh_HK">(
    contact.preferredLanguage === "en" ? "en" : "zh_HK",
  );
  const [evidence, setEvidence] = useState("");
  const verify = useMutation({
    mutationFn: () =>
      verifyClientContactPhone({
        data: {
          companyId,
          contactId: contact.id,
          phoneE164,
          preferredLanguage: language,
          verificationEvidence: evidence,
        },
      }),
    onSuccess: onVerified,
  });

  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer underline">
        {contact.phoneVerifiedAt ? "Messaging phone verified · review" : "Verify messaging phone"}
      </summary>
      <div className="mt-2 grid max-w-md gap-2 rounded-md border p-3">
        <p>
          Saved contact phone: {contact.phone ?? "missing"}. Confirm its E.164 form and source
          before messaging.
        </p>
        <label className="grid gap-1">
          Verified E.164
          <input
            className="rounded border px-2 py-1"
            value={phoneE164}
            onChange={(event) => setPhoneE164(event.target.value)}
            placeholder="+85291234567"
          />
        </label>
        <label className="grid gap-1">
          Preferred language
          <select
            className="rounded border px-2 py-1"
            value={language}
            onChange={(event) => setLanguage(event.target.value as "en" | "zh_HK")}
          >
            <option value="zh_HK">繁體中文（香港）</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="grid gap-1">
          Verification source and date
          <input
            className="rounded border px-2 py-1"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder="Confirmed by client call on YYYY-MM-DD"
          />
        </label>
        {verify.error ? (
          <p role="alert" className="text-destructive">
            {verify.error instanceof Error ? verify.error.message : "Unable to verify contact."}
          </p>
        ) : null}
        <button
          type="button"
          className="rounded border px-2 py-1 disabled:opacity-50"
          disabled={verify.isPending || !e164.test(phoneE164) || evidence.trim().length < 8}
          onClick={() => verify.mutate()}
        >
          {verify.isPending ? "Saving..." : "Confirm phone for messaging"}
        </button>
      </div>
    </details>
  );
}
