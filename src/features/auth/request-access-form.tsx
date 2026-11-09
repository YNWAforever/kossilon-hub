import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { submitRequestAccessRequest } from "@/features/onboarding/server-fns";

type Locale = "zh-HK" | "en";
type FormState = "idle" | "submitting" | "success" | "error";

/**
 * Persisted request-access form.
 *
 * Only rendered when the availability check confirms migration 0083 is applied
 * on the serving database. It stores contact details in the review queue; it
 * never creates an auth account and never sends documents.
 */
export function RequestAccessForm({ locale }: { locale: Locale }) {
  const en = locale === "en";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [firm, setFirm] = useState("");
  const [team, setTeam] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setError(null);

    if (!consent) {
      setState("error");
      setError(
        en
          ? "Please confirm the contact-details consent before sending."
          : "請先確認聯絡資料的使用同意。",
      );
      return;
    }

    try {
      const result = await submitRequestAccessRequest({
        data: {
          name,
          email,
          firm,
          team,
          message: note,
          consent: true,
          website,
        },
      });
      if (result.ok) {
        setDuplicate(result.duplicate);
        setState("success");
        return;
      }
      setState("error");
      setError(
        result.code === "rate-limited"
          ? en
            ? "Too many requests from this address. Try again later, or email the administrator."
            : "此電郵提交次數過多，請稍後再試，或直接電郵公司管理員。"
          : result.code === "unavailable"
            ? en
              ? "The request form is not available right now. Please email the administrator."
              : "申請表單暫時未能使用，請直接電郵公司管理員。"
            : en
              ? "The request could not be saved. Please try again or email the administrator."
              : "未能儲存申請，請重試或直接電郵公司管理員。",
      );
    } catch {
      setState("error");
      setError(
        en
          ? "The request could not be saved. Please try again or email the administrator."
          : "未能儲存申請，請重試或直接電郵公司管理員。",
      );
    }
  }

  if (state === "success") {
    return (
      <div
        role="status"
        className="mt-8 rounded-lg border border-status-green/30 bg-status-green-soft p-6 text-sm leading-6 text-status-green-text"
      >
        <p className="font-semibold">{en ? "Request received" : "已收到申請"}</p>
        <p className="mt-1">
          {duplicate
            ? en
              ? "There is already a pending request for this address. An administrator will review it."
              : "此電郵已有待處理的申請，管理員會一併處理。"
            : en
              ? "An administrator will review it and invite you through the sign-in email if approved."
              : "管理員會審核申請，如獲批准會以登入電郵邀請你。"}
        </p>
        <p className="mt-2 text-xs opacity-80">
          {en
            ? "No documents or passwords are needed for this request."
            : "此申請毋須提交文件或密碼。"}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" aria-busy={state === "submitting"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="request-access-name"
            className="text-xs font-medium text-muted-foreground"
          >
            {en ? "Name" : "姓名"}
          </label>
          <Input
            id="request-access-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            maxLength={120}
            className="mt-1.5 w-full"
          />
        </div>
        <div>
          <label
            htmlFor="request-access-email"
            className="text-xs font-medium text-muted-foreground"
          >
            {en ? "Work email" : "工作電郵"}
          </label>
          <Input
            id="request-access-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            required
            maxLength={254}
            className="mt-1.5 w-full"
          />
        </div>
      </div>

      <div>
        <label htmlFor="request-access-firm" className="text-xs font-medium text-muted-foreground">
          {en ? "Firm" : "公司"}
        </label>
        <Input
          id="request-access-firm"
          value={firm}
          onChange={(event) => setFirm(event.target.value)}
          autoComplete="organization"
          required
          maxLength={160}
          className="mt-1.5 w-full"
        />
      </div>

      <div>
        <label htmlFor="request-access-team" className="text-xs font-medium text-muted-foreground">
          {en ? "Team (optional)" : "團隊（選填）"}
        </label>
        <Input
          id="request-access-team"
          value={team}
          onChange={(event) => setTeam(event.target.value)}
          maxLength={160}
          className="mt-1.5 w-full"
        />
      </div>

      <div>
        <label
          htmlFor="request-access-message"
          className="text-xs font-medium text-muted-foreground"
        >
          {en ? "Anything else? (optional)" : "其他補充（選填）"}
        </label>
        <Textarea
          id="request-access-message"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          rows={3}
          className="mt-1.5 w-full"
        />
      </div>

      {/* Honeypot: hidden from real users and assistive tech. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="request-access-website">Website</label>
        <input
          id="request-access-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          required
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <span>
          {en
            ? "I agree that the firm administrator may store these details to review this request."
            : "本人同意公司管理員儲存以上資料以處理開通申請。"}
        </span>
      </label>

      {error && (
        <p role="alert" className="text-xs leading-5 text-status-red-text">
          {error}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        disabled={state === "submitting"}
        className="h-11 w-full"
      >
        {state === "submitting"
          ? en
            ? "Sending…"
            : "正在送出…"
          : en
            ? "Send request"
            : "送出申請"}
      </Button>

      <p className="text-center text-[11px] leading-5 text-muted-foreground">
        {en
          ? "Requests are reviewed manually. No documents or passwords are collected."
          : "申請由人手審核，不會收集文件或密碼。"}
      </p>
    </form>
  );
}
