"use client";

import { usePathname } from "next/navigation";

import { BankProvider } from "@/lib/bank-context";
import { FeaturesProvider } from "@/lib/features-context";
import { stripBasePath } from "@/lib/base-path";

// Authentication/account pages must not fetch memory data: a missing/expired
// session must not interrupt invitation acceptance or password changes.
export function isMemoryArea(pathname: string): boolean {
  const path = stripBasePath(pathname || "/").split(/[?#]/)[0];
  return !["/login", "/auth", "/account"].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/**
 * Mounts the memory data providers only inside the authenticated memory area.
 * On authentication/account pages it renders children without them, so they never call
 * the memory APIs. Leaving the area unmounts the providers, resetting their
 * state; entering it (after sign-in) mounts them fresh.
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
