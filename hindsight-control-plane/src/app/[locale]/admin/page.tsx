"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmButton, CopyButton } from "@/components/admin-controls";
import { adminFetch } from "@/lib/admin-api";
import { withBasePath } from "@/lib/base-path";

interface UserRow {
  handle: string;
  display_name: string;
  status: string;
  active_keys: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [query, setQuery] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/users");
      if (res.ok) setUsers((await res.json()).users ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? users.filter((u) => u.handle.includes(q) || u.display_name.toLowerCase().includes(q))
      : users;
  }, [users, query]);

  async function createUser(issueKey: boolean) {
    const res = await adminFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, display_name: displayName, issue_first_key: issueKey }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.detail || data.error || "Failed to create user");
      return;
    }
    toast.success(`User "${data.user?.handle}" created`);
    if (data.key?.secret) setNewKey(data.key.secret);
    setHandle("");
    setDisplayName("");
    await load();
  }

  async function act(path: string, ok: string) {
    const res = await adminFetch(path, { method: "POST" });
    if (res.ok) {
      toast.success(ok);
      await load();
    } else {
      toast.error("Action failed");
    }
  }

  async function removeUser(h: string) {
    const res = await adminFetch(`/api/admin/users/${encodeURIComponent(h)}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`User "${h}" deleted (schema and memories retained)`);
      await load();
    } else {
      toast.error("Delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Users</h1>

      <Card>
        <CardHeader>
          <h2 className="font-medium">Create user</h2>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm text-muted-foreground" htmlFor="handle">
              Handle
            </label>
            <Input
              id="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="alice"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground" htmlFor="display">
              Display name
            </label>
            <Input
              id="display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alice A."
            />
          </div>
          <Button onClick={() => createUser(false)} disabled={!handle}>
            Create
          </Button>
          <Button variant="secondary" onClick={() => createUser(true)} disabled={!handle}>
            Create + issue key
          </Button>
        </CardContent>
      </Card>

      {newKey && (
        <Card>
          <CardContent className="space-y-2 pt-4">
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
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <h2 className="font-medium">All users</h2>
          <Input
            className="max-w-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users…"
            aria-label="Search users"
          />
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Handle</th>
                <th>Name</th>
                <th>Status</th>
                <th>Active keys</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    {users.length === 0
                      ? "No users yet. Create one above."
                      : "No users match your search."}
                  </td>
                </tr>
              ) : (
                shown.map((u) => (
                  <tr key={u.handle} className="border-t">
                    <td className="py-2 font-medium">{u.handle}</td>
                    <td>{u.display_name}</td>
                    <td>{u.status}</td>
                    <td>{u.active_keys}</td>
                    <td className="space-x-2 text-right">
                      <Button size="sm" variant="outline" asChild>
                        <a href={withBasePath(`/admin/users/${u.handle}`)}>Edit</a>
                      </Button>
                      {u.status === "active" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            act(`/api/admin/users/${u.handle}/disable`, `${u.handle} disabled`)
                          }
                        >
                          Disable
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            act(`/api/admin/users/${u.handle}/enable`, `${u.handle} enabled`)
                          }
                        >
                          Enable
                        </Button>
                      )}
                      <ConfirmButton
                        label="Delete"
                        title={`Delete user "${u.handle}"?`}
                        description="All of this user's keys are revoked and the user is removed from the list. Their memory schema and memories are retained and are not deleted here (a database-owner action). The handle stays reserved."
                        confirmLabel="Delete user"
                        onConfirm={() => removeUser(u.handle)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
