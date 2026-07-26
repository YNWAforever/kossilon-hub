import { useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AccountBlock, BrandBlock, NavList } from "./nav-content";

/**
 * Mobile header. The sidebar is hidden below `md`, so without this the app
 * exposed only a hardcoded subset of destinations on small screens.
 */
export function AppMobileNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);

  // Close on navigation so the drawer never covers the page the user just chose.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-3 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Open navigation menu"
          className="flex h-11 w-11 items-center justify-center rounded-md text-foreground transition hover:bg-accent"
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-5">
            <BrandBlock />
          </div>
          <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto p-2">
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          </nav>
          <AccountBlock />
        </SheetContent>
      </Sheet>

      <BrandBlock />
    </header>
  );
}
