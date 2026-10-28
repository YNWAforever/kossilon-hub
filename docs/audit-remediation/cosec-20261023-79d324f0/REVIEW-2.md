# Review 2 — immutable source-review record

Worktree: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`  
Branch/base: `codex/cosec-20261023` / `1c57a67213af72bff8d776694e6ed8c986b921db` plus the inspected dirty sources and new files.

This preserves the second review as issued. Findings describe that source snapshot, not subsequent fixes. Keep this file unchanged; record implementation and later verification in separate receipts.

Six actionable **P2** findings remain in the inspected sources:

1. **Queue return URLs discard real cursors.** `src/features/work-items/queue-view-state.ts:23`  
   Opening a case from page 3 builds `returnTo` using `URLSearchParams`. The router parses the JSON cursor into an object, which `queueViewSearch` drops, returning to page 1. Numeric searches also become empty. Use the router serializer. **Test:** round-trip a real server cursor through the actual router and detail return link.

2. **Verified but unfinished cases disappear from Today.** `src/features/annual-return/work-views-other-repository.ts:79`  
   Verifying the final checklist item leaves either domain's status at `Documents pending`. With no missing, received or rejected items, the case matches none of the five categories. Include these cases in an appropriate review/follow-up category without asserting filing readiness. **Test:** verify the final item in both domains and assert the unfinished case remains reachable from Today.

3. **Annual-return links lose Today's other-business page.** `src/routes/today.tsx:275`  
   After paging other-business work, opening an annual-return case calls `dailyReturnPath`, which omits `otherCursor`. Returning resets the other-business section to page 1. Preserve both cursors consistently. **Test:** set both continuations, open an annual-return row, then verify both survive the return.

4. **Repeated queue filters silently widen the read.** `src/features/work-items/queue-view-state.ts:12`  
   For example, `view=team&q=a&q=b` becomes an empty search; repeated owner/status values become `all`. The page issues a broader authorized read instead of rejecting malformed context. Validate supplied values before applying defaults. **Test:** repeated filters show a recoverable error and issue no queue or snapshot read.

5. **R20's refresh button cannot retry a first-page failure.** `src/features/incorporation/components/case-list-controls.tsx:103`  
   Without a cursor, "重新整理列表" navigates to the same URL and leaves the query key unchanged. With `retry:false`, it does not retry either list's failed request. Wire an explicit refetch. **Test:** reject the initial request, click refresh, and assert a second request renders recovered results.

6. **Client-overview case links lose the originating client.** `src/features/clients/components/client-work-overview.tsx:88`  
   These links pass no return context, so each case's return action opens its business list instead of the client overview. Carry an explicitly allowed client-detail return destination. **Test:** client → each of the three case types → return restores the same client and register context.

The earlier client-detail `returnTo` omission was fixed during review and is excluded. No `otherCursor` schema finding: the annual-return schema strips it.

Source review only; no edits, DB/network access, tests or commits were performed in the review turn. No native acceptance claimed.
