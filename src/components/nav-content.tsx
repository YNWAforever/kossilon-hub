import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/auth-context-neon";
import { isNavItemActive, navGroups } from "./navigation";

/**
 * Grouped destination list shared by the desktop sidebar and the mobile drawer.
 * `onNavigate` lets the drawer close itself after a selection.
 */
export function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-5">
      {navGroups.map((group) => (
        <div key={group.heading}>
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.heading}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isNavItemActive(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to as never}
                    // Without this, TanStack marks /whatsapp active on /whatsapp/automation.
                    activeOptions={item.exact ? { exact: true } : undefined}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      // min-h-11 keeps every row at or above the 44px touch target.
                      "group flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                      item.nested && "ml-3",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Signed-in identity plus sign-out. Lives in the sidebar and drawer, which every
 * authenticated screen renders, rather than in a per-page header — that is what
 * previously left users with no way to sign out on most routes.
 */
export function AccountBlock() {
  const { session, signOut } = useAuth();

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
        {session?.initials ?? "--"}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs font-semibold text-foreground">
          {session?.name ?? "Signed in"}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{session?.role ?? "User"}</div>
      </div>
      <button
        onClick={signOut}
        aria-label="Sign out"
        title="Sign out"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

export function BrandBlock() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <span className="font-display text-sm font-bold">K</span>
      </div>
      <div className="leading-tight">
        <div className="font-display text-sm font-semibold text-sidebar-foreground">Kossilon</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CoSec OS</div>
      </div>
    </div>
  );
}
