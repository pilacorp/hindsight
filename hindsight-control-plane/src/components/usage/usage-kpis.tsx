"use client";

import type { LucideIcon } from "lucide-react";
import { Activity, AlertTriangle, Coins, Database, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { formatCompact, type UsageSummary } from "@/lib/usage-dashboard";

function Kpi({
  icon: Icon,
  label,
  value,
  exact,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  exact?: number;
  hint: string;
}) {
  return (
    <Card className="p-4 last:col-span-2 lg:last:col-span-1">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="rounded-md bg-muted p-1.5">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        {label}
      </div>
      <p
        className="mt-3 text-2xl font-semibold leading-tight tabular-nums text-foreground"
        title={exact != null ? exact.toLocaleString() : undefined}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">{hint}</p>
    </Card>
  );
}

export function UsageKpis({ summary }: { summary: UsageSummary }) {
  const t = useTranslations("usage");
  const failureRate =
    summary.failureRate == null
      ? t("noValue")
      : `${(summary.failureRate * 100).toFixed(1).replace(/\.0$/, "")}%`;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Kpi
        icon={Activity}
        label={t("kpiOperations")}
        value={formatCompact(summary.operations)}
        exact={summary.operations}
        hint={t("kpiOperationsHint", { failed: summary.failures.toLocaleString() })}
      />
      <Kpi
        icon={AlertTriangle}
        label={t("kpiFailureRate")}
        value={failureRate}
        hint={summary.failureRate == null ? t("kpiFailureRateNone") : t("kpiFailureRateHint")}
      />
      <Kpi
        icon={Coins}
        label={t("kpiTokens")}
        value={formatCompact(summary.tokens)}
        exact={summary.tokens}
        hint={t("kpiTokensHint", { cached: formatCompact(summary.cachedInput) })}
      />
      <Kpi
        icon={Database}
        label={t("kpiStored")}
        value={formatCompact(summary.memoryUnits)}
        exact={summary.memoryUnits}
        hint={t("kpiStoredHint", {
          documents: summary.documents.toLocaleString(),
          banks: summary.banks.toLocaleString(),
        })}
      />
      <Kpi
        icon={Users}
        label={t("kpiActiveMembers")}
        value={summary.activeMembers.toLocaleString()}
        hint={t("kpiActiveMembersHint", { total: summary.totalMembers })}
      />
    </div>
  );
}

/** Same footprint as the loaded dashboard, so nothing jumps when data arrives. */
export function UsageSkeleton() {
  const t = useTranslations("usage");
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">{t("loading")}</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Card
            key={index}
            className="h-[110px] animate-pulse bg-muted/40 motion-reduce:animate-none last:col-span-2 lg:last:col-span-1"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="h-[320px] animate-pulse bg-muted/40 motion-reduce:animate-none lg:col-span-2" />
        <Card className="h-[320px] animate-pulse bg-muted/40 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
