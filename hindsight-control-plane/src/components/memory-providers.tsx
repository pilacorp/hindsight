"use client";

import { usePathname } from "next/navigation";

import { BankProvider } from "@/lib/bank-context";
import { FeaturesProvider } from "@/lib/features-context";
import { stripBasePath } from "@/lib/base-path";

// The login page must NOT fetch memory data (no session yet): mounting
// BankProvider/FeaturesProvider there triggered 401 errors and toasts on a page
// that has no business reading memory. (The admin area is gone as of #10.)
export function isMemoryArea(pathname: string): boolean {
  return !stripBasePath(pathname || "/").startsWith("/login");
}

/**
 * Mounts the memory data providers only inside the authenticated memory area.
 * On the login page it renders children without them, so that page never calls
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
