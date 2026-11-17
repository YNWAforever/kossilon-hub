# Feedback form and outreach copy

## Feedback form (Google Forms / Tally)

Title: **ComSec OS demo — quick feedback (2 minutes)**

Intro: “Thanks for the walkthrough. This is a read-only demo with fictional data. Five quick questions help us shape the
pilot; no client data is collected here.”

1. Your role and firm size (owner/partner, manager, operations, IT; 1–10 / 11–50 / 50+ staff)
2. Which workflow is most painful today? (annual returns, document chasing, payments, client updates, team handover, other)
3. What would make a 2-week pilot worth it for your team? (short answer)
4. Which integrations matter first? (email, WhatsApp, document scanning/storage, accounting/import, none yet)
5. Would you like a pilot conversation? (yes / later / no) + name, work email, preferred contact method, consent to follow up

Optional rating: “How clear was the demo?” 1–5.

Owner action: create the form, send the link in the follow-up email, and keep responses out of the demo workspace. If no
form tool is available, use the note field on the production request-access form and reply from the owner inbox.

## Booking

Use the production request-access form: https://kossilon-hub.vercel.app/request-access

It persists a request to the admin queue. The demo deployment’s own `/request-access` shows setup instructions rather than
the form, so always send the production link. State the response time the owner commits to (for example “within one
business day”).

## Invitation email / message (Chinese)

> 你好 [Name]，
>
> 多謝你對 ComSec OS 有興趣。呢個係我哋為香港公司秘書團隊而設嘅工作空間，將周年申報、文件追收、付款同客戶更新放喺同一宗個案入面。
>
> 你可以用以下連結直接試玩（約 10 分鐘，唔需要登入資料，資料係虛構同唯讀）：
> https://kossilon-hub-demo.vercel.app/
>
> 入到去揀「示範身份」任何一個角色就得。想我哋帶你行一次 15 分鐘嘅流程，可以喺呢度留低聯絡方法：
> https://kossilon-hub.vercel.app/request-access
>
> 注意：示範係唯讀環境，唔好輸入真實客戶資料；正式 pilot 會係獨立、可寫入嘅工作空間。
>
> [Your name]

## Invitation email (English)

> Hi [Name],
>
> ComSec OS is a company-secretary operations workspace for Hong Kong firms — annual returns, document chasing, payments
> and client updates in one case record.
>
> Try the read-only demo (about 10 minutes, no credentials needed, fictional data):
> https://kossilon-hub-demo.vercel.app/
>
> Choose any persona under “Demo identities”. If you would like a 15-minute guided walkthrough, leave your details here:
> https://kossilon-hub.vercel.app/request-access
>
> Please don’t enter real client data in the demo; a pilot workspace is separate and writable.
>
> [Your name]

## Follow-up after the demo (same day)

> 多謝今日時間。兩條 link 方便你同同事再睇：
> 示範：https://kossilon-hub-demo.vercel.app/
> 兩分鐘意見： [feedback form link]
>
> 你提到最想解決 [workflow]。我哋可以喺 pilot 用你哋真實嘅個案流程試兩星期；想知你 prefer 邊個時間傾？

Record objections and the requested integration order; that becomes the Phase B/C input.
