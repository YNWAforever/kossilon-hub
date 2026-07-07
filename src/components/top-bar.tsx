import { Search, Bell, HelpCircle, LogOut } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";

export function TopBar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { session, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 md:flex md:w-72">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Search clients, cases, enquiries…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </div>

        {actions}

        <button
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        <button
          className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-status-red" />
        </button>

        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
            {session?.initials ?? "--"}
          </div>
          <div className="hidden text-right leading-tight md:block">
            <div className="text-xs font-semibold text-foreground">
              {session?.name ?? "Signed in"}
            </div>
            <div className="text-[10px] text-muted-foreground">{session?.role ?? "User"}</div>
          </div>
        </div>

        <button
          onClick={signOut}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
