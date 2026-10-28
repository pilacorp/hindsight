"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  memberRows,
  sortRows,
  type MemberUsage,
  type SortDirection,
  type SortKey,
} from "@/lib/usage-dashboard";
import { cn } from "@/lib/utils";

export function UsageMemberTable({
  members,
  selected,
  onSelect,
}: {
  members: MemberUsage[];
  /** Email of the member the charts are filtered to, or null for the team. */
  selected: string | null;
  onSelect: (email: string | null) => void;
}) {
  const t = useTranslations("usage");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "operations",
    direction: "desc",
  });
  const rows = useMemo(
    () => sortRows(memberRows(members), sort.key, sort.direction),
    [members, sort]
  );

  const columns: Array<{ key: SortKey; label: string }> = [
    { key: "email", label: t("colMember") },
    { key: "operations", label: t("colOperations") },
    { key: "retain", label: t("retain") },
    { key: "recall", label: t("recall") },
    { key: "reflect", label: t("reflect") },
    { key: "failures", label: t("failed") },
    { key: "tokens", label: t("colTokens") },
    { key: "memoryUnits", label: t("colMemoryUnits") },
    { key: "documents", label: t("colDocuments") },
  ];

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "email" ? "asc" : "desc" }
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="text-sm font-semibold text-foreground">{t("membersTitle")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("membersSummary", { count: members.length })}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {columns.map((column) => {
                  const active = sort.key === column.key;
                  const SortIcon = !active
                    ? ArrowUpDown
                    : sort.direction === "asc"
                      ? ArrowUp
                      : ArrowDown;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                      }
                      className={cn(
                        "py-2 pr-3 font-medium",
                        column.key !== "email" && "text-right"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(column.key)}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active && "text-foreground"
                        )}
                      >
                        {column.label}
                        <SortIcon className="h-3 w-3" aria-hidden />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = row.email === selected;
                return (
                  <tr
                    key={row.email}
                    className={cn(
                      "border-b border-border/60 transition-colors hover:bg-muted/40",
                      isSelected && "bg-muted/60"
                    )}
                  >
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        title={t("filterToMember")}
                        onClick={() => onSelect(isSelected ? null : row.email)}
                        className="cursor-pointer rounded-sm text-left font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.email}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold">
                      {row.operations.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-right">{row.retain.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{row.recall.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{row.reflect.toLocaleString()}</td>
                    <td
                      className={cn("py-2 pr-3 text-right", row.failures > 0 && "text-destructive")}
                    >
                      {row.failures.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-right">{row.tokens.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{row.memoryUnits.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{row.documents.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
