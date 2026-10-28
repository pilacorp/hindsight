"use client";

import { Suspense, useState, FormEvent, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { sanitizeReturnTo, withBasePath } from "@/lib/base-path";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import Image from "next/image";

// Issue #10: identity is the internal Supabase Auth. The dashboard no longer
// accepts a Hindsight API key; a developer signs in with their Supabase email
// and password, and supabase-js then forwards that session's access token on
// every memory-bank request.
function LoginForm() {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Validate returnTo to prevent open-redirect via crafted login links.
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  useEffect(() => {
    document.getElementById("email")?.focus();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error: signInError } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message || t("invalidKey"));
        return;
      }
      router.push(returnTo);
      router.refresh();
    } catch {
      setError(t("connectFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Image
            src={withBasePath("/logo.png")}
            alt="Hindsight"
            width={160}
            height={160}
            className="mx-auto"
            unoptimized
          />
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !email || !password}>
              {loading ? t("signingIn") : t("signIn")}
            </Button>
            <a
              href={withBasePath("/usage")}
              className="block text-center text-sm text-primary underline"
            >
              {t("teamUsage")}
            </a>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
