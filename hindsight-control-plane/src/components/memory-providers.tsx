"use client";

import { usePathname } from "next/navigation";

import { BankProvider } from "@/lib/bank-context";
import { FeaturesProvider } from "@/lib/features-context";
import { stripBasePath } from "@/lib/base-path";

// Paths that must NOT fetch memory data: the login page (no session yet) and
// the admin area (admin sessions are intentionally barred from memory, so
// /api/banks → 403). Mounting BankProvider/FeaturesProvider there triggered
// 401/403/500 errors and toasts on pages that have no business reading memory.
export function isMemoryArea(pathname: string): boolean {
  const p = stripBasePath(pathname || "/");
  return !p.startsWith("/login") && !(p === "/admin" || p.startsWith("/admin/"));
}

/**
 * Mounts the memory data providers only inside the authenticated user memory
 * area. On login and admin pages it renders children without them, so those
 * pages never call the memory APIs. Leaving the area unmounts the providers,
 * resetting their state; entering it (after user sign-in) mounts them fresh.
 */
export function MemoryProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!isMemoryArea(pathname ?? "/")) {
    return <>{children}</>;
  }
  return (
    <FeaturesProvider>
      <BankProvider>{children}</BankProvider>
    </FeaturesProvider>
  );
}
