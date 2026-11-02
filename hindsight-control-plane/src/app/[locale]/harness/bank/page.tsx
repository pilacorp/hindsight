"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { client } from "@/lib/api";
import { bankChoiceUrl, loopbackRedirect, validBankId } from "@/lib/harness-bank";
import { stripBasePath, withBasePath } from "@/lib/base-path";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BankRow {
  bank_id: string;
  name?: string | null;
}

function HarnessBankChooser() {
  const searchParams = useSearchParams();
  const redirectRaw = searchParams.get("redirect_uri");
  const redirect = useMemo(() => loopbackRedirect(redirectRaw), [redirectRaw]);
  const state = searchParams.get("state") ?? "";
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [selected, setSelected] = useState("");
  const [newBankId, setNewBankId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!redirect || !state) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const session = (await supabase.auth.getSession()).data.session;
        if (!session) {
          const returnTo = stripBasePath(`${window.location.pathname}${window.location.search}`);
          window.location.href = withBasePath(`/login?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }
        const page = await client.listBanks({ limit: 100 });
        if (!cancelled) setBanks(page.banks ?? []);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load banks.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [redirect, state]);

  function choose(bankId: string) {
    if (!redirect || !state || !validBankId(bankId)) return;
    window.location.href = bankChoiceUrl(redirect, bankId, state);
  }

  async function createAndChoose(event: FormEvent) {
    event.preventDefault();
    const bankId = newBankId.trim();
    if (!validBankId(bankId)) {
      setError("Use a bank id of letters, digits, dots, underscores, or hyphens.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await client.createBank(bankId);
      choose(bankId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the bank.");
      setLoading(false);
    }
  }

  if (!redirect || !state) {
    return (
      <Card className="mx-auto mt-16 w-full max-w-lg">
        <CardHeader>
          <CardTitle>Bank link refused</CardTitle>
          <CardDescription>
            This page only returns a bank id to the local NDA Harness setup command.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Choose a memory bank</CardTitle>
          <CardDescription>
            Pick a bank for this NDA Harness setup, or create one. The choice goes back to the local command.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {banks.map((bank) => (
            <Button
              key={bank.bank_id}
              type="button"
              variant={selected === bank.bank_id ? "default" : "outline"}
              onClick={() => setSelected(bank.bank_id)}
            >
              {bank.name || bank.bank_id}
            </Button>
          ))}
          <Button type="button" disabled={!selected} onClick={() => choose(selected)}>
            Use this bank
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Create a bank</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createAndChoose} className="flex flex-col gap-3">
            <Input
              value={newBankId}
              onChange={(event) => setNewBankId(event.target.value)}
              placeholder="bank-id"
              autoComplete="off"
            />
            <Button type="submit" disabled={loading || !newBankId.trim()}>
              {loading ? "Creating…" : "Create and use"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export default function HarnessBankPage() {
  return (
    <Suspense>
      <HarnessBankChooser />
    </Suspense>
  );
}
