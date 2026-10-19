import { useRouterState } from "@tanstack/react-router";

import { AccountBlock, BrandBlock, NavList } from "./nav-content";

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
        <BrandBlock />
      </div>

      <nav aria-label="主要導覽" className="flex-1 overflow-y-auto p-2">
        <NavList pathname={pathname} />
      </nav>

      <AccountBlock />
    </aside>
  );
}
