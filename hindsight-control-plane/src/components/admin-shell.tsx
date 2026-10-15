"use client";

import { usePathname } from "next/navigation";
import { LogOut, Users, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logout } from "@/lib/admin-api";
import { stripBasePath, withBasePath } from "@/lib/base-path";

const NAV = [
  {
    href: "/admin",
    label: "Users",
    icon: Users,
    match: (p: string) => p === "/admin" || p.startsWith("/admin/users"),
  },
  {
    href: "/admin/audit",
    label: "Audit",
    icon: ScrollText,
    match: (p: string) => p.startsWith("/admin/audit"),
  },
];

/** Admin chrome: a sticky header with navigation, a signed-in indicator, and
 * logout, around every /admin page. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = stripBasePath(usePathname() ?? "/admin");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <span className="font-semibold">Hindsight Admin</span>
          <nav className="flex items-center gap-1" aria-label="Admin sections">
            {NAV.map(({ href, label, icon: Icon, match }) => (
              <a
                key={href}
                href={withBasePath(href)}
                aria-current={match(pathname) ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                  match(pathname)
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Signed in as admin</span>
            <Button size="sm" variant="secondary" onClick={() => logout()} aria-label="Log out">
              <LogOut className="mr-1.5 h-4 w-4" aria-hidden /> Logout
            </Button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
