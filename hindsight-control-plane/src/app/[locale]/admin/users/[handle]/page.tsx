"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface KeyRow {
  id: string;
  prefix: string;
  label: string;
  status: string;
  created_at: string | null;
  last_used_at: string | null;
}

export default function UserDetailPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(handle)}`, { cache: "no-store" });
    if (res.status === 404) { setNotFound(true); return; }
    const data = await res.json();
    setDisplayName(data.user?.display_name ?? "");
    setStatus(data.user?.status ?? "");
    setKeys(data.keys ?? []);
  }, [handle]);

  useEffect(() => { void load(); }, [load]);

  async function saveName() {
    await fetch(`/api/admin/users/${encodeURIComponent(handle)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName }),
    });
    await load();
  }

  async function toggle() {
    const action = status === "active" ? "disable" : "enable";
    await fetch(`/api/admin/users/${encodeURIComponent(handle)}/${action}`, { method: "POST" });
    await load();
  }

  async function generateKey() {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(handle)}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    if (data.key?.secret) setNewKey(data.key.secret);
    setLabel("");
    await load();
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Other keys keep working.")) return;
    await fetch(`/api/admin/keys/${encodeURIComponent(id)}/revoke`, { method: "POST" });
    await load();
  }

  if (notFound) return <div className="p-6">No such user.</div>;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">{handle} <span className="text-sm text-muted-foreground">({status})</span></h1>

      <Card>
        <CardHeader><h2 className="font-medium">Details</h2></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm text-muted-foreground">Display name</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <Button onClick={saveName}>Save</Button>
          <Button variant="secondary" onClick={toggle}>{status === "active" ? "Disable" : "Enable"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="font-medium">API keys</h2></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-sm text-muted-foreground">Label</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop" />
            </div>
            <Button onClick={generateKey}>Generate key</Button>
          </div>
          {newKey && (
            <div className="space-y-2">
              <p className="text-sm font-medium">New key — shown once, copy it now:</p>
              <code className="block break-all rounded bg-muted p-2 text-sm">{newKey}</code>
              <Button size="sm" variant="secondary" onClick={() => setNewKey(null)}>Dismiss</Button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Label</th><th>Prefix</th><th>Status</th><th>Created</th><th>Last used</th><th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="py-2">{k.label || "—"}</td>
                  <td><code>{k.prefix}</code></td>
                  <td>{k.status}</td>
                  <td>{k.created_at?.slice(0, 10) ?? "—"}</td>
                  <td>{k.last_used_at?.slice(0, 10) ?? "—"}</td>
                  <td className="text-right">
                    {k.status === "active" && (
                      <Button size="sm" variant="destructive" onClick={() => revoke(k.id)}>Revoke</Button>
                    )}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No keys.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
