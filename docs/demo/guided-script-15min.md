# 15-minute guided demo script

Audience: owner/partner and operations lead of a Hong Kong company-secretarial firm.
Goal: they recognise their current workflow, trust the role/permission model, and agree to a short pilot conversation.

Setup: `https://kossilon-hub-demo.vercel.app/login` → **Amy Chan (Admin)**. Say once, at the start:
“This is a read-only demo with fictional data. Anything that would write or send is intentionally disabled.”

## 0:00–1:00 — Frame the problem

> “公司秘書團隊通常同時追 周年申報、文件、付款同老闆/客戶嘅問題，進度散落喺 Excel、WhatsApp 同同事記憶。
> ComSec OS 將每一宗個案嘅下一步、負責人同到期日放返同一個工作空間。”

Keep it to 60 seconds; do not tour the marketing page.

## 1:00–3:30 — Admin: what the team sees today (Amy)

Open **今日工作** (`/today`), then **總覽** (`/dashboard`), then **工作隊列** (`/work-queue`).

- Point to overdue/upcoming counts and what is due today.
- In 工作隊列, show that rows carry owner, company, status and due date; the same list is the team’s daily chase board.
- Say: “每一行都係一宗個案，唔係一個 task；打開就見到成條流程同紀錄。”
- Avoid: any “新增/指派/完成” control. If clicked, it will show the read-only notice — use that as the honesty point.

## 3:30–6:00 — Admin: one annual-return case end to end

Open **周年申報** (`/annual-returns`), then open the first overdue row (for example a Harbour Trading/Kowloon Textiles case).

- Walk the status strip: upcoming → reminder → documents pending/received → payment → NAR1 prepared → signature → filed.
- Show the checklist, owner, due date, documents and payment state on one screen.
- Say: “狀態係共用語言；同事、經理同客戶都睇同一份事實。”
- Then open **文件** (`/documents`): missing vs received, what is being chased, and how a reminder would be recorded in production.
- Then **付款** (`/payments`): paid/pending/overdue and proof state; explain that a case can be “ready” but payment-gated in production.

## 6:00–8:00 — Manager: scope and workload (Ken Wong)

Sign out (sidebar account block) → `/login` → **Ken Wong (Manager)**.

- Re-open 工作隊列 / 周年申報 and point out the manager sees the wider team scope, not a personal list.
- Say: “同一個畫面，按角色同 team 收窄；server-side 授權，唔係靠前端隱藏。”
- Do not claim features that are not on screen (no separate workload analytics dashboard).

## 8:00–9:30 — Staff: least privilege (Mei Lam)

Sign out → **Mei Lam (Staff)**.

- Show 今日工作 and the work queue; staff sees assigned work and can act only within that scope.
- Say: “新人第一日就知做邊幾宗；唔會誤改其他 team 嘅個案。”
- This is the moment to mention audit/history: every case carries a timeline of who did what.

## 9:30–11:00 — Client-facing story

Sign back in as Amy (Admin), open **客戶入口** (`/portal`).

- The demo shows a client-style portal view for the selected case: progress, required actions, document/payment state, activity.
- Say: “客戶只會見到自己公司嘅個案同需要佢做嘅事；唔會見到其他客戶或者內部備註。”
- Honesty note: the demo has no Client persona yet; this is the staff-side view of the client experience.

## 11:00–13:30 — Trust: roles, invite-only, integrations

Open **系統運作** (`/operations`), then **用戶管理** (`/admin`) if the audience asks about setup.

- 系統運作 shows deployment identity, scheduler health, capability states and security posture; it is designed to be
  honest about what is configured.
- 用戶管理 shows that accounts are invite-only, with roles Admin/Manager/Staff and client memberships by company.
- If asked about WhatsApp/email/scanner: “功能須完成服務設定先會啟用；未啟用時系統會顯示未配置，不會扮有。”
- Do not demo 設定 (`/settings`) unless asked; it is admin-only and not part of the story.

## 13:30–15:00 — Close

Summarise in three sentences:

1. One shared case record replaces scattered spreadsheets and chat chasing.
2. Roles and invite-only access keep client data scoped to the right people.
3. The pilot is a small, real workspace with your own team and processes.

Then:

- Offer the 2-week pilot / next conversation; send the booking link in writing.
- Ask for the feedback form before they leave the call (or send immediately after).
- Do not improvise pricing; capture their budget expectation instead.

## Common objections

| Objection                  | Answer                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| “Can I upload/create now?” | “This demo is read-only by design so nobody accidentally writes. A pilot workspace is writable and scoped to your team.”               |
| “Is WhatsApp live?”        | “The inbox/chase experience is designed; it needs WOZTELL service configuration before it sends anything. We show the state honestly.” |
| “Where is our data?”       | “Production runs on Vercel with Neon Postgres; demo data is fictional. Residency/DPA details are confirmed for the pilot.”             |
| “How much?”                | “Pricing and limits are still being confirmed; pilot terms are part of the next conversation.”                                         |
| “Can we import our cases?” | “Import/onboarding is scoped with the pilot; don’t promise a self-serve import in the demo.”                                           |

## Reset after the call

Nothing to delete: reload or sign out and the fixtures reset. If the prospect sent real files during the call, do not
upload them; keep them in your own secure channel and follow the firm’s data-handling policy.
