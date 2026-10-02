// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AuthRole } from "@/features/auth/types";
const auth = vi.hoisted(() => ({ role: "Admin" as AuthRole }));
vi.mock("@/features/auth/auth-context-neon", () => ({
  useAuth: () => ({ session: { role: auth.role } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    activeOptions: _options,
    ...props
  }: {
    to: string;
    children: import("react").ReactNode;
    activeOptions?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
import { navGroups } from "./navigation";
import { NavList } from "./nav-content";
afterEach(cleanup);
describe("daily role navigation", () => {
  it("retains all sixteen Admin destinations in five business groups", () => {
    expect(navGroups.map((g) => g.heading)).toEqual([
      "今日工作",
      "案件與客戶",
      "文件與付款",
      "通訊",
      "管理",
    ]);
    auth.role = "Admin";
    render(<NavList pathname="/today" />);
    expect(screen.getAllByRole("link")).toHaveLength(16);
    expect(screen.getByRole("link", { name: "今日工作" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
  it.each(["Staff", "Manager"] as const)(
    "hides Admin-only links from %s without removing deep routes",
    (role) => {
      auth.role = role;
      render(<NavList pathname="/operations" />);
      expect(screen.getAllByRole("link").map((x) => x.getAttribute("href"))).not.toContain(
        "/admin",
      );
      expect(screen.getAllByRole("link").map((x) => x.getAttribute("href"))).not.toContain(
        "/settings",
      );
      expect(screen.queryByRole("link", { name: "用戶管理" })).toBeNull();
      expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
      expect(screen.getByRole("link", { name: "系統運作" })).toBeTruthy();
    },
  );
  it("Client sees only existing document and portal routes", () => {
    auth.role = "Client";
    render(<NavList pathname="/portal" />);
    expect(screen.getAllByRole("link").map((x) => x.getAttribute("href"))).toEqual([
      "/documents",
      "/portal",
    ]);
  });
});
