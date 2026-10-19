"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LanguageSwitcher } from "@/components/language-switcher";
import { withBasePath } from "@/lib/base-path";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PasswordGrant = { tokenHash: string; type: "invite" | "recovery" };

export function PasswordForm({ mode }: { mode: "setup" | "change" }) {
  const t = useTranslations("password");
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const grant = useRef<PasswordGrant | null | undefined>(undefined);
  const userId = useRef<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (mode === "setup") {
      if (grant.current === undefined) {
        const url = new URL(window.location.href);
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        grant.current =
          tokenHash && (type === "invite" || type === "recovery") ? { tokenHash, type } : null;
        // Keep the bearer token out of referrers/history. Do not consume it on
        // page load: email scanners must not accept invitations automatically.
        window.history.replaceState(null, "", window.location.pathname);
      }
      setReady(Boolean(grant.current));
      if (!grant.current) setError(t("invalidLink"));
      return;
    }

    let active = true;
    async function checkSession() {
      try {
        const { data, error: sessionError } = await getSupabaseBrowserClient().auth.getUser();
        if (!active) return;
        if (sessionError || !data.user) {
          setError(t("signInRequired"));
          return;
        }
        userId.current = data.user.id;
        setEmail(data.user.email || "");
        setReady(true);
      } catch {
        if (active) setError(t("connectionError"));
      }
    }
    void checkSession();
    return () => {
      active = false;
    };
  }, [mode, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || submitting.current) return;
    setError("");
    if (password !== confirmation) {
      setError(t("mismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("tooShort"));
      return;
    }
    if (mode === "change" && (!currentPassword || currentPassword === password)) {
      setError(t("differentPassword"));
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      const { auth } = getSupabaseBrowserClient();
      if (mode === "setup" && !userId.current) {
        if (!grant.current) throw new Error(t("invalidLink"));
        const { data, error: verificationError } = await auth.verifyOtp({
          token_hash: grant.current.tokenHash,
          type: grant.current.type,
        });
        if (
          verificationError &&
          (verificationError.name === "AuthRetryableFetchError" ||
            (verificationError.status !== undefined && verificationError.status >= 500))
        ) {
          throw new Error(t("connectionError"));
        }
        if (verificationError || !data.user || !data.session) {
          setReady(false);
          throw new Error(t("invalidLink"));
        }
        userId.current = data.user.id;
        grant.current = null;
      }

      // A different tab can switch the persisted session while this form is open.
      const { data, error: sessionError } = await auth.getUser();
      if (sessionError || !data.user || data.user.id !== userId.current) {
        setReady(false);
        throw new Error(t("signInRequired"));
      }
      const { error: updateError } = await auth.updateUser({
        password,
        ...(mode === "change" ? { current_password: currentPassword } : {}),
      });
      if (updateError) throw updateError;
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      setComplete(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("connectionError"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const loginPath = mode === "change" ? "/login?returnTo=%2Faccount%2Fchange-password" : "/login";
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {mode === "change" && (
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
      )}
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Image
            src={withBasePath("/logo.png")}
            alt="Hindsight"
            width={120}
            height={120}
            className="mx-auto"
            unoptimized
          />
          <CardTitle>{t(mode === "setup" ? "setupTitle" : "changeTitle")}</CardTitle>
          <CardDescription>
            {t(mode === "setup" ? "setupDescription" : "changeDescription")}
          </CardDescription>
          {email && <p className="text-sm text-muted-foreground break-all">{email}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          {complete ? (
            <>
              <p role="status" className="text-sm">
                {t("success")}
              </p>
              <Button asChild className="w-full">
                <Link href={withBasePath("/dashboard")}>{t("continue")}</Link>
              </Button>
            </>
          ) : (
            <>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {ready && (
                <form onSubmit={submit} className="space-y-4">
                  {mode === "change" && (
                    <div className="space-y-2">
                      <label htmlFor="current-password" className="text-sm font-medium">
                        {t("currentPassword")}
                      </label>
                      <Input
                        id="current-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label htmlFor="new-password" className="text-sm font-medium">
                      {t("newPassword")}
                    </label>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      aria-describedby="password-requirements"
                    />
                    <p id="password-requirements" className="text-xs text-muted-foreground">
                      {t("requirements")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="confirm-password" className="text-sm font-medium">
                      {t("confirmPassword")}
                    </label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {t(busy ? "saving" : "save")}
                  </Button>
                </form>
              )}
              {!ready && !error && (
                <p role="status" className="text-sm">
                  {t("loading")}
                </p>
              )}
              <Link className="block text-center text-sm underline" href={withBasePath(loginPath)}>
                {t("signIn")}
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
