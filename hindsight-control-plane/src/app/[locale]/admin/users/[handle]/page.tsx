"use client";

import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmButton, CopyButton } from "@/components/admin-controls";
import { adminFetch } from "@/lib/admin-api";

interface KeyRow {
  id: string;
  prefix: string;
  label: string;
  status: string;
  created_at: string | null;
  last_used_at: string | null;
}

interface Stats {
  banks: number;
  memories: number;
  documents: number;
  last_activity: string | null;
}

export default function UserDetailPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/users/${encodeURIComponent(handle)}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setDisplayName(data.user?.display_name ?? "");
      setStatus(data.user?.status ?? "");
      setKeys(data.keys ?? []);
      const sres = await adminFetch(`/api/admin/users/${encodeURIComponent(handle)}/stats`);
      if (sres.ok) setStats(await sres.json());
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveName() {
    const res = await adminFetch(`/api/admin/users/${encodeURIComponent(handle)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName }),
    });
    toast[res.ok ? "success" : "error"](res.ok ? "Saved" : "Save failed");
    if (res.ok) await load();
  }

  async function toggle() {
    const action = status === "active" ? "disable" : "enable";
    const res = await adminFetch(`/api/admin/users/${encodeURIComponent(handle)}/${action}`, {
      method: "POST",
    });
    toast[res.ok ? "success" : "error"](res.ok ? `User ${action}d` : "Action failed");
    if (res.ok) await load();
  }

  async function generateKey() {
    const res = await adminFetch(`/api/admin/users/${encodeURIComponent(handle)}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.key?.secret) {
      setNewKey(data.key.secret);
      toast.success("Key generated — copy it now");
    } else {
      toast.error("Failed to generate key");
    }
    setLabel("");
    await load();
  }

  async function revoke(id: string) {
    const res = await adminFetch(`/api/admin/keys/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
    });
    toast[res.ok ? "success" : "error"](res.ok ? "Key revoked" : "Revoke failed");
    if (res.ok) await load();
  }

  if (notFound) return <div className="p-6">No such user.</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">
        {handle} <span className="text-sm text-muted-foreground">({status || "…"})</span>
      </h1>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Banks", stats?.banks],
          ["Memories", stats?.memories],
          ["Documents", stats?.documents],
          ["Last activity", stats?.last_activity?.slice(0, 10) ?? "—"],
        ].map(([k, v]) => (
          <Card key={k as string}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-xl font-semibold">{loading ? "…" : (v ?? 0)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-medium">Details</h2>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm text-muted-foreground" htmlFor="dn">
              Display name
            </label>
            <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <Button onClick={saveName}>Save</Button>
          <Button variant="secondary" onClick={toggle}>
            {status === "active" ? "Disable" : "Enable"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-medium">API keys</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-sm text-muted-foreground" htmlFor="label">
                Label
              </label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="laptop"
              />
            </div>
            <Button onClick={generateKey}>Generate key</Button>
          </div>
          {newKey && (
            <div className="space-y-2">
              <p className="text-sm font-medium">New key — shown once, copy it now:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted p-2 text-sm">
                  {newKey}
                </code>
                <CopyButton value={newKey} />
              </div>
              <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>
                Dismiss
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Label</th>
                  <th>Prefix</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-muted-foreground">
                      No keys.
                    </td>
                  </tr>
                ) : (
                  keys.map((k) => (
                    <tr key={k.id} className="border-t">
                      <td className="py-2">{k.label || "—"}</td>
                      <td>
                        <code>{k.prefix}</code>
                      </td>
                      <td>{k.status}</td>
                      <td>{k.created_at?.slice(0, 10) ?? "—"}</td>
                      <td>{k.last_used_at?.slice(0, 10) ?? "—"}</td>
                      <td className="text-right">
                        {k.status === "active" && (
                          <ConfirmButton
                            label="Revoke"
                            title="Revoke this key?"
                            description="This key stops working immediately. The user's other keys keep working."
                            confirmLabel="Revoke key"
                            onConfirm={() => revoke(k.id)}
                          />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
