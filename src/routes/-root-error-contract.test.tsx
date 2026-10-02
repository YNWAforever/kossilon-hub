// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => "/documents",
}));

import { Route } from "./__root";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([null, "inert string error", new Error("inert Error")])(
  "renders the Router unknown-error contract: %s",
  (error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ErrorComponent = Route.options.errorComponent as ComponentType<{
      error: unknown;
      reset: () => void;
    }>;
    render(createElement(ErrorComponent, { error, reset: vi.fn() }));
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "No error message was provided.";
    expect(screen.getByText(message)).toBeTruthy();
  },
);
