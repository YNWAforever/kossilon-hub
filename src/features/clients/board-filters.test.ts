import { describe, expect, it } from "vitest";
import { clientSearchFromUrl, type ClientRegisterSearch } from "./board-filters";

describe("clientSearchFromUrl", () => {
  it("defaults status to active when absent", () => {
    expect(clientSearchFromUrl({})).toEqual<ClientRegisterSearch>({
      q: undefined,
      packageName: undefined,
      teamName: undefined,
      status: "active",
    });
  });

  it("keeps recognised values", () => {
    expect(
      clientSearchFromUrl({
        q: "harbour",
        packageName: "Standard",
        teamName: "Filing",
        status: "inactive",
      }),
    ).toEqual<ClientRegisterSearch>({
      q: "harbour",
      packageName: "Standard",
      teamName: "Filing",
      status: "inactive",
    });
  });

  it("accepts the all status", () => {
    expect(clientSearchFromUrl({ status: "all" }).status).toBe("all");
  });

  it("degrades an unrecognised status to active rather than throwing", () => {
    expect(clientSearchFromUrl({ status: "banana" }).status).toBe("active");
  });

  it("drops empty and non-string filter values", () => {
    const search = clientSearchFromUrl({ q: "", packageName: 42, teamName: null });

    expect(search.q).toBeUndefined();
    expect(search.packageName).toBeUndefined();
    expect(search.teamName).toBeUndefined();
  });
});
