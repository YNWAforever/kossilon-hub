// @vitest-environment jsdom

import { useRef } from "react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChecklistTemplate,
  ChecklistTemplatePatch,
} from "@/features/checklist-templates/types";
import { guardMutation } from "@/lib/guard-mutation";

const serverFns = vi.hoisted(() => ({
  updateChecklistTemplate: vi.fn(),
}));

vi.mock("@/features/checklist-templates/server-fns", () => serverFns);

import { DocumentsTab, WhatsAppIntegrationStatus } from "./settings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WhatsAppIntegrationStatus", () => {
  it("labels simulated delivery and hides live binding details", () => {
    render(
      <WhatsAppIntegrationStatus
        status={{
          deliveryMode: "simulated",
          missingLiveEnvVars: [
            "WOZTELL_API_BASE_URL",
            "WOZTELL_ACCESS_TOKEN",
            "WOZTELL_CHANNEL_ID",
            "WOZTELL_WEBHOOK_SECRET",
          ],
        }}
      />,
    );

    expect(screen.getByText("Demo simulation")).toBeTruthy();
    expect(screen.getByText("No external WhatsApp or email message is sent.")).toBeTruthy();
    expect(screen.queryByText(/Missing bindings:/)).toBeNull();
  });

  it("shows missing live bindings only when delivery is blocked", () => {
    render(
      <WhatsAppIntegrationStatus
        status={{
          deliveryMode: "blocked",
          missingLiveEnvVars: ["WOZTELL_API_BASE_URL", "WOZTELL_CHANNEL_ID"],
        }}
      />,
    );

    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(
      screen.getByText("Missing bindings: WOZTELL_API_BASE_URL, WOZTELL_CHANNEL_ID"),
    ).toBeTruthy();
  });

  it("shows configured without a demo notice for live delivery", () => {
    render(<WhatsAppIntegrationStatus status={{ deliveryMode: "live", missingLiveEnvVars: [] }} />);

    expect(screen.getByText("Configured")).toBeTruthy();
    expect(screen.queryByText("Demo simulation")).toBeNull();
    expect(screen.queryByText(/Missing bindings:/)).toBeNull();
  });
});

// Regression coverage for a data-loss bug found in code review: every add/remove/edit control in
// DocumentsTab/RemindersTab/RisksTab built its patch by spreading the *current* `t` prop, which
// only updates once a mutation's full round trip (server write + refetch) completes. Nothing
// disabled the controls while a mutation was in flight, so two rapid clicks could both close over
// the same stale array and race — whichever write committed last silently discarded the other's
// change, because `updateTemplate` does a full-column replace, not a merge.
//
// The fix in `settings.tsx` has two layers: a rendered `isSaving` flag (true for the entire round
// trip of any of the four template mutations, including the refetch) that disables every mutating
// control and editable field as a UX signal, PLUS a synchronous `mutationInFlightRef` guard around
// every real `mutate()` call site, because TanStack Query defers the re-render that flips
// `isPending` via `setTimeout(fn, 0)` — not synchronously — leaving a narrow window where two
// `mutate()` calls issued in the same tick could both fire before any render catches up. This test
// proves the actual guarantee (only one mutation call ever fires) at the lowest level that can
// exercise the real timing: a real `useMutation` wired to a controllable, unresolved promise,
// exactly like `SettingsPage` wires `DocumentsTab`, but standalone (no router/auth harness needed
// since `DocumentsTab` takes no route or auth context) — with the same guarded `updateMutation`
// shape `SettingsPage` passes down.
describe("DocumentsTab — concurrent-write protection", () => {
  const template: ChecklistTemplate = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Annual return — Private Ltd",
    serviceType: "Annual Return — Private Ltd",
    description: "",
    active: true,
    documents: [],
    reminders: [],
    riskRules: [],
    updatedAt: "2026-08-18T00:00:00.000Z",
  };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  // Mirrors exactly how `SettingsPage` wires `DocumentsTab`: the raw `useMutation` result drives
  // `isSaving` (the rendered, eventually-consistent UX signal), but the `updateMutation` prop
  // actually passed down is `mutate` wrapped in the same exported `guardMutation` — the
  // synchronous, ref-based guard that is the real fix for the race.
  function DocumentsTabWithRealMutation() {
    const mutationInFlightRef = useRef(false);
    const updateMutation = useMutation({
      mutationFn: (input: { id: string; patch: ChecklistTemplatePatch }) =>
        serverFns.updateChecklistTemplate({ data: input }),
      onSettled: () => {
        mutationInFlightRef.current = false;
      },
    });
    const guardedUpdateMutation = {
      mutate: guardMutation(
        mutationInFlightRef,
        (input: { id: string; patch: ChecklistTemplatePatch }) => updateMutation.mutate(input),
      ),
    };
    return (
      <DocumentsTab
        t={template}
        dataMode="production"
        isSaving={updateMutation.isPending}
        updateMutation={guardedUpdateMutation}
      />
    );
  }

  function renderHarness() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <DocumentsTabWithRealMutation />
      </QueryClientProvider>,
    );
  }

  it("lets only one mutation fire when Add document is clicked twice in the same tick, even before the button visually disables", async () => {
    const { promise, resolve } = deferred<ChecklistTemplate>();
    serverFns.updateChecklistTemplate.mockReturnValue(promise);

    renderHarness();
    const addButton = screen.getByRole("button", { name: /add document/i }) as HTMLButtonElement;

    // Two clicks, back to back, with nothing awaited in between — the exact "click twice
    // quickly" scenario from the bug report, before the first mutation's promise has resolved.
    // The `mutationInFlightRef` guard is checked and set *synchronously* inside this same click
    // handling, at the call boundary before `updateMutation.mutate` is ever invoked — so by the
    // time the second `fireEvent.click` runs, the guard has already latched from the first click,
    // regardless of anything TanStack Query itself schedules asynchronously internally.
    fireEvent.click(addButton);
    fireEvent.click(addButton);

    // TanStack Query defers its own internal work by at least one microtask (an `await` on
    // `onMutate`, even though none is configured here, still suspends via the microtask queue —
    // see `Mutation.execute` in `@tanstack/query-core`), so the mutationFn call this asserts on
    // hasn't necessarily landed yet immediately after the synchronous clicks above. `waitFor`
    // lets that microtask resolve before checking the call count.
    await waitFor(() => expect(serverFns.updateChecklistTemplate).toHaveBeenCalled());
    expect(serverFns.updateChecklistTemplate).toHaveBeenCalledTimes(1);

    // The visual `disabled` state does catch up shortly after (once TanStack Query's deferred
    // notification runs), confirming the UX signal isn't broken — just not synchronous.
    await waitFor(() => expect(addButton.disabled).toBe(true));

    resolve(template);
    await waitFor(() => expect(addButton.disabled).toBe(false));
  });
});
