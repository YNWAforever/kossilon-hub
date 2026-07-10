import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import "../styles.css";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/portal", label: "Portal" },
  { to: "/payments", label: "Payments" },
  { to: "/whatsapp", label: "WhatsApp" },
  { to: "/whatsapp/automation", label: "WhatsApp Automation" },
  { to: "/annual-returns", label: "Annual returns" },
  { to: "/clients", label: "Clients" },
  { to: "/tasks", label: "Tasks" },
  { to: "/documents", label: "Documents" },
  { to: "/settings", label: "Settings" },
] as const;

const mobileNavItems = [
  { to: "/portal", label: "Portal" },
  { to: "/payments", label: "Payments" },
  { to: "/whatsapp/automation", label: "Automation" },
  { to: "/annual-returns", label: "Annual returns" },
] as const;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Kossilon Hub" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="min-h-screen bg-background text-foreground">
          <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-sidebar p-4 lg:block">
            <div className="mb-6">
              <p className="font-display text-lg font-semibold">Kossilon Hub</p>
              <p className="text-xs text-muted-foreground">CoSec operations</p>
            </div>
            <nav aria-label="Primary navigation" className="space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="block rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
                  activeProps={{
                    className: "block rounded-md bg-sidebar-accent px-3 py-2 text-sm font-medium",
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          <main className="lg:pl-64">
            <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="font-display font-semibold">Kossilon Hub</p>
                <nav
                  aria-label="Operational navigation"
                  className="flex min-w-0 flex-1 flex-wrap justify-end gap-2"
                >
                  {mobileNavItems.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                      activeProps={{
                        className:
                          "rounded-md border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground",
                      }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </header>
            <Outlet />
          </main>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
