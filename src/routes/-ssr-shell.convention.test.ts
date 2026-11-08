import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

// The login shell used to be client-only: the server sent a title and nothing
// else. It now renders on the server like the public marketing documents, and
// the `?error=` banner moved into an effect so server and client agree on the
// first render.
describe("public shell SSR convention", () => {
  it("server-renders the login shell without a hydration-time query read", () => {
    const root = route("./__root.tsx");
    const login = route("./login.tsx");

    expect(root).toContain("isServerRenderable(location.pathname) ? true : undefined");
    expect(login).toContain("ssr: true");
    expect(login).toContain("setCallbackError(");
    expect(login).not.toContain('typeof window !== "undefined"');
  });
});
