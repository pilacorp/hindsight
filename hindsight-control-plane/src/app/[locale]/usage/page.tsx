"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ActivityTrendChart,
  MemberBarChart,
  OperationMixChart,
  TokenTrendChart,
} from "@/components/usage/usage-charts";
import { UsageKpis, UsageSkeleton } from "@/components/usage/usage-kpis";
import { UsageMemberTable } from "@/components/usage/usage-member-table";
import { withBasePath } from "@/lib/base-path";
import { formatAbsoluteDateTime } from "@/lib/relative-time";
import {
  hasActivity,
  rankMembers,
  summarize,
  USAGE_RANGES,
  type UsageBody,
  type UsageRange,
} from "@/lib/usage-dashboard";

/** A trend needs a few points to read as one; a single day is shown as totals only. */
const MIN_TREND_POINTS = 4;
const WHOLE_TEAM = "__team__";

export default function UsagePage() {
  const t = useTranslations("usage");
  const format = useFormatter();
  const [range, setRange] = useState<UsageRange>("7d");
  const [body, setBody] = useState<UsageBody | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "disabled" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setBody(null);
    fetch(withBasePath(`/api/usage/team?range=${range}`))
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404) {
          setStatus("disabled");
          return;
        }
        if (!response.ok) {
          setStatus("error");
          return;
        }
        setBody((await response.json()) as UsageBody);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const rangeLabel: Record<UsageRange, string> = {
    today: t("rangeToday"),
    "7d": t("range7d"),
    "30d": t("range30d"),
  };

  const member = body?.members.find((entry) => entry.email === selected) ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Globe className="h-3 w-3" aria-hidden />
                {t("publicBadge")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            {status === "ready" && body?.snapshot_at ? (
              <p
                className="text-xs text-muted-foreground"
                title={formatAbsoluteDateTime(body.snapshot_at)}
              >
                {t("updated", {
                  time: format.relativeTime(new Date(body.snapshot_at), new Date()),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {body && body.members.length > 0 ? (
              <Select
                value={selected ?? WHOLE_TEAM}
                onValueChange={(value) => setSelected(value === WHOLE_TEAM ? null : value)}
              >
                <SelectTrigger className="h-10 sm:w-64" aria-label={t("memberFilter")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_TEAM}>{t("memberFilterAll")}</SelectItem>
                  {body.members.map((entry) => (
                    <SelectItem key={entry.email} value={entry.email}>
                      {entry.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Tabs value={range} onValueChange={(value) => setRange(value as UsageRange)}>
              <TabsList aria-label={t("range")}>
                {USAGE_RANGES.map((id) => (
                  <TabsTrigger key={id} value={id} className="cursor-pointer">
                    {rangeLabel[id]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </header>

        {status === "loading" ? <UsageSkeleton /> : null}
        {status === "disabled" ? (
          <Alert>
            <AlertDescription>{t("notEnabled")}</AlertDescription>
          </Alert>
        ) : null}
        {status === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{t("unavailable")}</AlertDescription>
          </Alert>
        ) : null}

        {status === "ready" && body ? (
          <Dashboard body={body} member={member} onSelect={setSelected} selected={selected} />
        ) : null}
      </main>
    </div>
  );
}

function Dashboard({
  body,
  member,
  selected,
  onSelect,
}: {
  body: UsageBody;
  member: UsageBody["members"][number] | null;
  selected: string | null;
  onSelect: (email: string | null) => void;
}) {
  const t = useTranslations("usage");
  const slice = member ?? body.team;
  const summary = summarize(slice, member ? [member] : body.members);
  const empty = !hasActivity(slice);
  const showTrends = slice.series.length >= MIN_TREND_POINTS;

  return (
    <div className="space-y-4">
      {member ? (
        <p className="text-sm text-muted-foreground">
          {t("showingMember", { email: member.email })}{" "}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="cursor-pointer rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("memberFilterAll")}
          </button>
        </p>
      ) : null}
      <UsageKpis summary={summary} />

      {!showTrends ? <p className="text-xs text-muted-foreground">{t("trendNeedsDays")}</p> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {showTrends ? (
          <ActivityTrendChart className="lg:col-span-2" series={slice.series} empty={empty} />
        ) : null}
        <OperationMixChart activity={slice.activity} empty={empty} />
        {showTrends ? <TokenTrendChart series={slice.series} empty={empty} /> : null}
        <MemberBarChart
          title={t("chartTopMembers")}
          summary={t("chartTopMembersSummary")}
          ranked={rankMembers(body.members, "operations")}
          valueLabel={t("colOperations")}
          color="var(--primary)"
          emptyMessage={t("emptyActivity")}
        />
        <MemberBarChart
          title={t("chartStored")}
          summary={t("chartStoredSummary")}
          ranked={rankMembers(body.members, "memoryUnits")}
          valueLabel={t("colMemoryUnits")}
          color="var(--chart-3)"
          emptyMessage={t("emptyStored")}
        />
      </div>

      <UsageMemberTable members={body.members} selected={selected} onSelect={onSelect} />
    </div>
  );
}
