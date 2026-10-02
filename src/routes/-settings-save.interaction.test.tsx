// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { act } from "@testing-library/react";
const fns = vi.hoisted(() => ({
  listChecklistTemplates: vi.fn(),
  createChecklistTemplate: vi.fn(),
  updateChecklistTemplate: vi.fn(),
  duplicateChecklistTemplate: vi.fn(),
  deleteChecklistTemplate: vi.fn(),
  previewChecklistTemplateMigration: vi.fn(),
}));
vi.mock("@/features/checklist-templates/server-fns", () => fns);
vi.mock("@/features/whatsapp/server-fns", () => ({
  getWhatsAppIntegrationStatus: async () => ({ deliveryMode: "blocked", missingLiveEnvVars: [] }),
}));
vi.mock("@/features/auth/auth-context-neon", () => ({
  useAuth: () => ({ isCurrentUserAdmin: true, session: { role: "Admin" } }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production" }),
  }),
}));
import { Route } from "./settings";
const Page = Route.options.component!;
const template = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Controlled template",
  serviceType: "Annual Return — Private Ltd",
  description: "",
  active: true,
  documents: [],
  reminders: [],
  riskRules: [],
  updatedAt: "2026-10-02T00:00:00Z",
  revision: 1,
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fns.listChecklistTemplates.mockResolvedValue([template]);
  fns.previewChecklistTemplateMigration.mockResolvedValue({
    revision: 1,
    cases: [],
    unknownLegacyCases: 0,
    nextCursor: null,
  });
});
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Await TanStack's explicit route preload before rendering its lazy wrapper.
  await Page.preload?.();
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={<p>Local test loading</p>}>
          <Page />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  return client;
}
describe("actual settings save feedback", () => {
  it("binds the draft to its observed revision across another admin's refetch", async () => {
    fns.updateChecklistTemplate.mockRejectedValue(new Error("409: Template revision changed"));
    const client = await mount();
    const name = await screen.findByDisplayValue("Controlled template");
    await act(async () => {
      client.setQueryData(
        ["checklist-templates"],
        [{ ...template, name: "Other admin", revision: 2 }],
      );
    });
    await screen.findByText("Other admin");
    fireEvent.blur(name);
    expect(fns.updateChecklistTemplate).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "My draft" } });
    fireEvent.blur(name);
    await screen.findByRole("alert");
    expect(fns.updateChecklistTemplate).toHaveBeenCalledWith({
      data: { id: template.id, patch: { name: "My draft" }, expectedRevision: 1 },
    });
    expect(screen.getByDisplayValue("My draft")).toBeTruthy();
  });
  it("shows pending/saved and sends the current template revision", async () => {
    let resolve!: (value: unknown) => void;
    fns.updateChecklistTemplate.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await mount();
    const name = await screen.findByDisplayValue("Controlled template");
    fireEvent.change(name, { target: { value: "Changed template" } });
    fireEvent.blur(name);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("儲存中"));
    expect(fns.updateChecklistTemplate).toHaveBeenCalledWith({
      data: { id: template.id, patch: { name: "Changed template" }, expectedRevision: 1 },
    });
    fns.listChecklistTemplates.mockResolvedValue([
      { ...template, name: "Changed template", revision: 2 },
    ]);
    resolve({ ...template, name: "Changed template", revision: 2 });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已儲存"));
  });
  it("retains failed input, exposes a live error, and retries only on an explicit click", async () => {
    fns.updateChecklistTemplate
      .mockRejectedValueOnce(new Error("Controlled offline"))
      .mockResolvedValueOnce({ ...template, name: "Keep me", revision: 2 });
    await mount();
    const name = await screen.findByDisplayValue("Controlled template");
    fireEvent.change(name, { target: { value: "Keep me" } });
    fireEvent.blur(name);
    expect((await screen.findByRole("alert")).textContent).toContain("Controlled offline");
    expect(screen.getByDisplayValue("Keep me")).toBeTruthy();
    expect(fns.updateChecklistTemplate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重試儲存" }));
    await waitFor(() => expect(fns.updateChecklistTemplate).toHaveBeenCalledTimes(2));
    expect(fns.updateChecklistTemplate.mock.calls[1][0]).toEqual(
      fns.updateChecklistTemplate.mock.calls[0][0],
    );
  });
  it("reloads a conflicting revision only after an explicit discard, without another write", async () => {
    fns.updateChecklistTemplate.mockRejectedValue(new Error("409: Template revision changed"));
    await mount();
    const name = await screen.findByDisplayValue("Controlled template");
    fireEvent.change(name, { target: { value: "Unsaved conflict" } });
    fireEvent.blur(name);
    await screen.findByRole("alert");
    expect(screen.getByDisplayValue("Unsaved conflict")).toBeTruthy();
    fns.listChecklistTemplates.mockResolvedValue([
      { ...template, name: "Other user's edit", revision: 2 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "重新載入（放棄未儲存輸入）" }));
    await screen.findByDisplayValue("Other user's edit");
    expect(screen.queryByDisplayValue("Unsaved conflict")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fns.updateChecklistTemplate).toHaveBeenCalledTimes(1);
  });
});
