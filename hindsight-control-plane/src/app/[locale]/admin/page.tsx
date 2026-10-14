"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { withBasePath } from "@/lib/base-path";

interface UserRow {
  handle: string;
  display_name: string;
  status: string;
  active_keys: number;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      router.push(withBasePath("/login"));
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(issueKey: boolean) {
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, display_name: displayName, issue_first_key: issueKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.detail || data.error || "failed to create user");
      return;
    }
    if (data.key?.secret) setNewKey(data.key.secret);
    setHandle("");
    setDisplayName("");
    await load();
  }

  async function act(path: string, method = "POST") {
    await fetch(path, { method });
    await load();
  }

  async function removeUser(h: string) {
    if (!confirm(`Delete user "${h}"? All their keys are revoked and they are removed from the list. Their memory schema and memories are retained (a database-owner action) and are not deleted here.`))
      return;
    await act(`/api/admin/users/${encodeURIComponent(h)}`, "DELETE");
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>

      <Card>
        <CardHeader><h2 className="font-medium">Create user</h2></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm text-muted-foreground">Handle</label>
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="alice" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground">Display name</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alice A." />
          </div>
          <Button onClick={() => createUser(false)} disabled={!handle}>Create</Button>
          <Button variant="secondary" onClick={() => createUser(true)} disabled={!handle}>Create + issue key</Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {newKey && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-medium">New key — shown once, copy it now:</p>
            <code className="block break-all rounded bg-muted p-2 text-sm">{newKey}</code>
            <Button size="sm" variant="secondary" onClick={() => setNewKey(null)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Handle</th><th>Name</th><th>Status</th><th>Keys</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.handle} className="border-t">
                  <td className="py-2">
                    <a className="underline" href={withBasePath(`/admin/users/${u.handle}`)}>{u.handle}</a>
                  </td>
                  <td>{u.display_name}</td>
                  <td>{u.status}</td>
                  <td>{u.active_keys}</td>
                  <td className="space-x-2 text-right">
                    {u.status === "active" ? (
                      <Button size="sm" variant="secondary" onClick={() => act(`/api/admin/users/${u.handle}/disable`)}>Disable</Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => act(`/api/admin/users/${u.handle}/enable`)}>Enable</Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => removeUser(u.handle)}>Delete</Button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
