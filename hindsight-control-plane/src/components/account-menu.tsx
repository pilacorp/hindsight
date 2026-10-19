"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { withBasePath } from "@/lib/base-path";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AccountMenu() {
  const t = useTranslations("account");
  const tPassword = useTranslations("password");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = getSupabaseBrowserClient().auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null)
    );
    return () => subscription.unsubscribe();
  }, []);

  const name = user?.user_metadata?.full_name || user?.user_metadata?.name;

  async function logout() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      // Reload to clear the memory area's in-memory state as well as the session.
      window.location.href = withBasePath("/login");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <UserRound className="h-4 w-4" />
          {t("title")}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>{t("signedInAs")}</DropdownMenuLabel>
        <div className="px-2.5 pb-2 text-sm">
          {typeof name === "string" && name.trim() && (
            <p className="break-words font-medium">{name}</p>
          )}
          <p className="break-all text-muted-foreground">{user?.email || "—"}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={withBasePath("/account/change-password")}>
            <KeyRound />
            {tPassword("changeTitle")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={logout}>
          <LogOut />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
