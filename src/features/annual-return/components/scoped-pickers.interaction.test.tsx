// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StaffPicker, DocumentPicker } from "./scoped-pickers";
const mocks = vi.hoisted(() => ({ staff: vi.fn(), documents: vi.fn() }));
vi.mock("../server-fns", () => ({ listAssignableStaff: mocks.staff }));
vi.mock("@/features/documents/server-fns", () => ({
  listDocumentPage: mocks.documents,
  listDocuments: vi.fn().mockResolvedValue([]),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function wrap(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {child}
    </QueryClientProvider>,
  );
}
it("searches all authorised staff before the bounded page", async () => {
  mocks.staff.mockImplementation(async ({ data } = { data: {} }) =>
    data.q === "5001" ? [{ id: "member5001", name: "Member5001", role: "Staff" }] : [],
  );
  wrap(<StaffPicker id="owner" label="Owner" value="" onChange={() => {}} actorScope="actorA" />);
  fireEvent.change(screen.getByLabelText("搜尋Owner"), { target: { value: "5001" } });
  expect(await screen.findByText("Member5001 · Staff")).toBeTruthy();
  expect(mocks.staff).toHaveBeenLastCalledWith({ data: { q: "5001", limit: 200 } });
});
it("clears the submitted staff selection when the operator changes its search", async () => {
  mocks.staff.mockResolvedValue([{ id: "memberA", name: "Member A", role: "Staff" }]);
  const changed = vi.fn();
  wrap(
    <StaffPicker id="owner" label="Owner" value="memberA" onChange={changed} actorScope="actorA" />,
  );
  await screen.findByText("Member A · Staff");
  fireEvent.change(screen.getByLabelText("搜尋Owner"), { target: { value: "B" } });
  expect(changed).toHaveBeenCalledWith("");
});
it("clears the submitted document and version when its search changes", async () => {
  mocks.documents.mockResolvedValue({ documents: [], nextCursor: null });
  const changed = vi.fn(),
    selected = vi.fn();
  wrap(
    <DocumentPicker
      id="proof"
      label="Proof"
      caseId="case"
      categories={["payment"]}
      value="docA"
      onChange={changed}
      onSelectDocument={selected}
      actorScope="actorA"
    />,
  );
  fireEvent.change(screen.getByLabelText("搜尋Proof文件"), { target: { value: "B" } });
  expect(changed).toHaveBeenCalledWith("");
  expect(selected).toHaveBeenCalledWith(undefined);
});
it("does not claim no evidence while more authorised pages exist and searches the full scope", async () => {
  mocks.documents.mockImplementation(async ({ data }) => ({
    documents: [],
    nextCursor: data.q ? null : "next",
  }));
  wrap(
    <DocumentPicker
      id="proof"
      label="Proof"
      caseId="case"
      categories={["payment"]}
      value=""
      onChange={() => {}}
      actorScope="actorA"
    />,
  );
  const more = await screen.findByRole("button", { name: "載入更多Proof文件" });
  expect(screen.queryByText("此案件沒有合適的已核實文件")).toBeNull();
  fireEvent.click(more);
  await waitFor(() =>
    expect(mocks.documents).toHaveBeenCalledWith({
      data: { caseId: "case", category: "payment", q: "", limit: 100, cursor: "next" },
    }),
  );
  fireEvent.change(screen.getByLabelText("搜尋Proof文件"), { target: { value: "5001" } });
  await waitFor(() =>
    expect(mocks.documents).toHaveBeenCalledWith({
      data: { caseId: "case", category: "payment", q: "5001", limit: 100, cursor: undefined },
    }),
  );
});
