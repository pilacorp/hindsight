"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { adminFetch } from "@/lib/admin-api";

interface AuditEvent {
  at: string;
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminFetch("/api/admin/audit");
        if (res.ok) setEvents((await res.json()).events ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <Card>
        <CardHeader>
          <h2 className="font-medium">Management actions</h2>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No events yet.
                  </td>
                </tr>
              ) : (
                events.map((e, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="py-2 whitespace-nowrap">
                      {e.at?.slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="whitespace-nowrap">{e.actor}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{e.action}</td>
                    <td className="whitespace-nowrap">{e.target ?? "—"}</td>
                    <td className="font-mono text-xs text-muted-foreground">
                      {Object.keys(e.details || {}).length ? JSON.stringify(e.details) : "—"}
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
