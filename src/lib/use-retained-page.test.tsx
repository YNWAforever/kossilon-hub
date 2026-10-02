// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useRetainedPage } from "./use-retained-page";
afterEach(cleanup);
it("retains loaded rows on failed next page only within the same actor/filter/sort scope", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Page({ scope, cursor }: { scope: string; cursor?: string }) {
    const q = useQuery({
      queryKey: [scope, cursor],
      queryFn: async () => {
        if (cursor || scope !== "actorA/filterA") throw new Error("Controlled failure");
        return { rows: ["A private row"] };
      },
    });
    const page = useRetainedPage(scope, q.data);
    return (
      <>
        <div>{page?.rows.join(",")}</div>
        {q.isError ? <p role="alert">Failed cursor</p> : null}
      </>
    );
  }
  const tree = (scope: string, cursor?: string) => (
    <QueryClientProvider client={client}>
      <Page scope={scope} cursor={cursor} />
    </QueryClientProvider>
  );
  const view = render(tree("actorA/filterA"));
  await screen.findByText("A private row");
  view.rerender(tree("actorA/filterA", "next"));
  await screen.findByRole("alert");
  expect(screen.getByText("A private row")).toBeTruthy();
  view.rerender(tree("actorB/filterA", "next"));
  await waitFor(() => expect(screen.queryByText("A private row")).toBeNull());
  view.rerender(tree("actorA/filterB", "next"));
  expect(screen.queryByText("A private row")).toBeNull();
});
