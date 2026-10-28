# ComSec OS marketing implementation plan

> Execute in this session using superpowers:executing-plans. The user has already approved the locked design defaults; no further design approval is required.

**Goal:** Public zh-HK marketing at `/`, English at `/en`, and working gated staff/client navigation, delivered as a draft PR to main.

**Architecture:** Reuse TanStack Start. Move the existing dashboard unchanged to `/dashboard`; publish two thin marketing routes backed by shared locale copy and scoped CSS. Marketing bypasses auth bootstrap; login and protected routes retain it.

**Spec:** User request and attached `brief.md` (locked defaults and acceptance).

**Global constraints:** ComSec OS branding on marketing; primary CTA `/login`; pricing TBC; synthetic illustration disclosure; no production, merge, mark-ready, Native/AP, or protocol stack changes. Base `53d840b4914c5170582703e027c35b758981b14f`, draft PR targeting main.

**Review focus:** Exact public-route matching; anonymous SSR without auth configuration; stored/explicit marketing redirects after login; staff/client separation; mobile/keyboard/no-JS navigation.

## Task 1: Routing and auth

- [ ] Extend route guard tests: `/` and `/en` public; dashboard, portal and prefix lookalikes protected. Unsafe/public redirects default to `/dashboard`; safe deep links preserved.
- [ ] Observe expected failures, then update helpers and login fallback. Move dashboard route and update its navigation, test entry paths and browser landing assertions. Preserve production staff `/today` default and Client `/portal`.
- [ ] Exercise actual root guards for anonymous, staff and Client actors with mocked auth transport. Run affected tests.

## Task 2: Marketing

- [ ] Add browser acceptance for anonymous SSR, locale links, CTA, anchors, FAQ, mobile reflow, keyboard navigation and staff/client demo landing. Observe root marketing assertions fail before implementing.
- [ ] Add locale content, shared marketing page, product illustration and scoped stylesheet; route `/` and `/en` with localized metadata/lang. Follow BuyerOS structure: nav, hero, values, workflow, features, TBC pricing, FAQ, dark CTA, footer.
- [ ] Keep marketing free of auth bootstrap/data loaders. Run browser scenarios and save screenshots/curl proof.

## Task 3: Validation and draft delivery

- [ ] Run lint, typecheck, unit suite, local browser suite, build and import-boundary checks. Record integration limitations; do not provision or write shared services.
- [ ] Review complete diff, fix material findings, commit and push the authorized branch. Open draft PR targeting main.
- [ ] Observe Node22, Node24 and verify to terminal state. One continuation-reflow flake rerun permitted. Attach proof and final tip SHA; verify draft and unmerged state.
