## Kossilon Company Secretary OS — Build Plan

A UI prototype for an internal SaaS dashboard used by a Hong Kong company secretary firm. All data mocked in-memory (no backend). Focus: deadline visibility, status clarity, complete UX across 10 pages.

### Visual System

- **Palette**: warm neutral — sand `#A69572`, taupe `#B39A6C`, warm gray `#BBB5A5`, white `#FFFFFF`, plus dark ink for text and semantic status colors.
- **Status colors** (semantic only): green on-track, yellow action-needed, orange deadline-approaching, red overdue, blue filed/completed.
- **Type**: Sora (headings), Manrope (body) via `@fontsource`.
- **Density**: Comfortable — Ramp-like breathing room, not Linear-dense.
- **Tokens** defined in `src/styles.css` under `@theme` (Tailwind v4).

### Information Architecture

Sidebar (persistent, collapsible): Dashboard, Enquiries, Clients, Annual Returns, Documents, Payments, WhatsApp Inbox, Tasks, Teams, Settings. Top bar: global search + user menu. Every detail view has a right-rail timeline.

### Pages

1. **Dashboard** (`/`) — 8 KPI cards (AR due 7d, AR due 30d, missing docs, payment pending, WhatsApp today, my cases, overdue, team workload) + "Upcoming annual returns" table + "Today's enquiries" + "Team workload" panels.
2. **Enquiries** (`/enquiries`) — WhatsApp conversation list with AI intent tag, quote status, assigned staff, convert-to-client button. Split view: list + conversation preview.
3. **Clients** (`/clients`) — Table of client companies. Row click → profile.
4. **Client profile** (`/clients/$id`) — Company details, contacts, AR history, docs, payments, assigned team, timeline rail.
5. **Annual Returns board** (`/annual-returns`) — Kanban with 11 status columns. Cards show company, deadline pill, next action, owner.
6. **AR case detail** (`/annual-returns/$id`) — Checklist of required docs (missing/received), reminders sent, uploaded files, staff notes, clear "Next action" panel, timeline.
7. **Documents** (`/documents`) — Cross-client doc library filtered by status.
8. **Payments** (`/payments`) — Invoice/payment tracking with reminder cadence.
9. **WhatsApp Inbox** (`/whatsapp`) — Full conversation UI with template picker + AI intent panel.
10. **WhatsApp Automation** (`/whatsapp/automation`) — Templates, reminder schedules, escalation rules, message logs.
11. **Tasks** (`/tasks`) — Task list assigned to current user + team.
12. **Teams** (`/teams`) — Teams, members, roles (Admin / Manager / Staff), client ownership.
13. **Settings** (`/settings`) — Checklist templates, service packages, risk rules, reminder cadence, WOZTELL API connection form (stub).

### Technical Approach

- TanStack Start file-based routes under `src/routes/`.
- Mock data module `src/lib/mock-data.ts` — companies, cases, enquiries, messages, tasks, team, timeline events. Deterministic seeds so numbers on dashboard match detail pages.
- Shared components in `src/components/`: `AppSidebar`, `TopBar`, `KpiCard`, `StatusPill`, `DeadlinePill`, `Timeline`, `CaseBoardColumn`, `CaseCard`, `ConversationList`, `MessageThread`, `ChecklistItem`.
- Shadcn primitives: sidebar, card, table, tabs, badge, button, input, dialog, dropdown, avatar, separator, scroll-area, tooltip.
- Icons from `lucide-react`.
- Each route has proper `head()` metadata (title + description).
- All navigation via `<Link to="...">`, no `<a href>`.

### Status Pill System

One reusable component maps case status → color:
- Upcoming, Filed, Completed → blue
- Reminder Sent, Documents Received, NAR1 Prepared, Ready to File → green
- Documents Pending, Signature Pending → yellow
- Payment Pending → orange (approaching deadline) or red (overdue)
- Overdue → red

Deadline pill: days-left → color (>30 green, 8-30 yellow, 1-7 orange, ≤0 red).

### Out of Scope (this build)

- Real backend / auth (mocked user "Amy Chan, Admin")
- Real WOZTELL integration (settings form stores locally)
- Real file uploads (mocked file list)
- Report exports

Ready to build on approval.