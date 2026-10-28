"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LegendPayload, TooltipContentProps } from "recharts";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  activityPoints,
  formatCompact,
  operationMix,
  OPERATIONS,
  tokenPoints,
  type Activity,
  type Operation,
  type RankedMember,
  type SeriesPoint,
} from "@/lib/usage-dashboard";

// Same tokens and conventions as the bank stats charts, so both dashboards read
// as one product in light and dark mode.
const USAGE_COLORS: Record<Operation | "failed" | "input" | "output" | "cached", string> = {
  retain: "var(--chart-1)",
  recall: "var(--chart-2)",
  reflect: "var(--chart-3)",
  failed: "var(--destructive)",
  input: "var(--chart-1)",
  output: "var(--chart-4)",
  cached: "var(--chart-2)",
};
const GRID_STROKE = "var(--border)";
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)", fontWeight: 500 };
const CHART_HEIGHT = 220;

/** UTC calendar day `YYYY-MM-DD` as a short local label. */
function formatDay(day: string, locale: string, long = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(long ? { weekday: "short" } : {}),
  });
}

type TooltipRow = { name?: string; value?: number; color?: string };
type TooltipProps = Partial<TooltipContentProps<number, string>> & {
  /** Rows for values that are in the data point but not drawn as a series. */
  extraRows?: (point: Record<string, number>) => TooltipRow[];
};

function ChartTooltip({ active, payload, label, extraRows }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const rows: TooltipRow[] = [
    ...payload,
    ...(extraRows ? extraRows(payload[0].payload as Record<string, number>) : []),
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-popover/95 backdrop-blur-sm px-3 py-2 shadow-md">
      {label != null && (
        <div className="text-[11px] font-medium text-foreground mb-1.5">{label}</div>
      )}
      <div className="space-y-1">
        {rows.map((entry, index) => (
          <div key={index} className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-[2px]" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">
              {(entry.value ?? 0).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendText({ value }: { value: string }) {
  return <span className="text-[11px] font-medium text-muted-foreground">{value}</span>;
}

/** Legend props listing series in stacking order; Recharts sorts by label otherwise. */
function legendProps(order: readonly string[]) {
  return {
    iconType: "square" as const,
    iconSize: 8,
    itemSorter: (item: LegendPayload) => order.indexOf(String(item.dataKey)),
    formatter: (value: string) => <LegendText value={value} />,
  };
}

/**
 * Chart chrome: a titled card whose one-line summary is the text alternative,
 * plus a "View data" table so no number is available only on hover.
 */
export function ChartCard({
  title,
  summary,
  table,
  className,
  children,
}: {
  title: string;
  summary: string;
  table?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("usage");
  return (
    <Card className={className}>
      <figure className="m-0">
        <CardHeader className="pb-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <figcaption className="text-xs text-muted-foreground">{summary}</figcaption>
        </CardHeader>
        <CardContent className="space-y-3">
          {children}
          {table ? (
            <details className="text-xs">
              <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm w-fit">
                {t("viewData")}
              </summary>
              <div className="mt-2 overflow-x-auto">{table}</div>
            </details>
          ) : null}
        </CardContent>
      </figure>
    </Card>
  );
}

export function ChartEmpty({ message }: { message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-border px-6 text-center text-sm text-muted-foreground"
      style={{ height: CHART_HEIGHT }}
    >
      {message}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr className="text-left text-muted-foreground">
          {head.map((cell, index) => (
            <th
              key={index}
              scope="col"
              className={`py-1 pr-3 font-medium ${index > 0 ? "text-right" : ""}`}
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-t border-border/60">
            {row.map((cell, index) => (
              <td key={index} className={`py-1 pr-3 ${index > 0 ? "text-right" : ""}`}>
                {typeof cell === "number" ? cell.toLocaleString() : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ActivityTrendChart({
  series,
  empty,
  className,
}: {
  series: SeriesPoint[];
  empty: boolean;
  className?: string;
}) {
  const t = useTranslations("usage");
  const locale = useLocale();
  const points = activityPoints(series).map((point) => ({
    ...point,
    label: formatDay(point.day, locale),
  }));
  const total = points.reduce((sum, point) => sum + point.retain + point.recall + point.reflect, 0);
  const failed = points.reduce((sum, point) => sum + point.failed, 0);
  const names: Record<Operation, string> = {
    retain: t("retain"),
    recall: t("recall"),
    reflect: t("reflect"),
  };
  return (
    <ChartCard
      className={className}
      title={t("chartActivity")}
      summary={t("chartActivitySummary", {
        total: total.toLocaleString(),
        failed: failed.toLocaleString(),
      })}
      table={
        <DataTable
          head={[t("colDay"), names.retain, names.recall, names.reflect, t("failed")]}
          rows={points.map((point) => [
            point.label,
            point.retain,
            point.recall,
            point.reflect,
            point.failed,
          ])}
        />
      }
    >
      {empty ? (
        <ChartEmpty message={t("emptyActivity")} />
      ) : (
        <div style={{ height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                {OPERATIONS.map((op) => (
                  <linearGradient key={op} id={`usage-grad-${op}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={USAGE_COLORS[op]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={USAGE_COLORS[op]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                vertical={false}
                stroke={GRID_STROKE}
                strokeOpacity={0.5}
                strokeDasharray="2 4"
              />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                dy={4}
                minTickGap={16}
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
                tickFormatter={(value: number) => formatCompact(value)}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{
                  stroke: "var(--muted-foreground)",
                  strokeWidth: 1,
                  strokeDasharray: "3 3",
                }}
              />
              <Legend {...legendProps(OPERATIONS)} />
              {OPERATIONS.map((op) => (
                <Area
                  key={op}
                  type="monotone"
                  dataKey={op}
                  name={names[op]}
                  stackId="ops"
                  stroke={USAGE_COLORS[op]}
                  strokeWidth={2}
                  fill={`url(#usage-grad-${op})`}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function OperationMixChart({
  activity,
  empty,
  className,
}: {
  activity: Record<Operation, Activity>;
  empty: boolean;
  className?: string;
}) {
  const t = useTranslations("usage");
  const names: Record<Operation, string> = {
    retain: t("retain"),
    recall: t("recall"),
    reflect: t("reflect"),
  };
  const points = operationMix(activity).map((point) => ({
    ...point,
    label: names[point.operation],
  }));
  const totals = Object.fromEntries(
    points.map((point) => [point.operation, point.success + point.failure])
  );
  return (
    <ChartCard
      className={className}
      title={t("chartMix")}
      summary={t("chartMixSummary", {
        retain: (totals.retain ?? 0).toLocaleString(),
        recall: (totals.recall ?? 0).toLocaleString(),
        reflect: (totals.reflect ?? 0).toLocaleString(),
      })}
      table={
        <DataTable
          head={[t("colOperation"), t("succeeded"), t("failed")]}
          rows={points.map((point) => [point.label, point.success, point.failure])}
        />
      }
    >
      {empty ? (
        <ChartEmpty message={t("emptyActivity")} />
      ) : (
        <div style={{ height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                horizontal={false}
                stroke={GRID_STROKE}
                strokeOpacity={0.5}
                strokeDasharray="2 4"
              />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                tickFormatter={(value: number) => formatCompact(value)}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
              <Legend {...legendProps(["success", "failure"])} />
              <Bar
                dataKey="success"
                name={t("succeeded")}
                stackId="mix"
                fill="var(--chart-2)"
                isAnimationActive={false}
              />
              <Bar
                dataKey="failure"
                name={t("failed")}
                stackId="mix"
                fill={USAGE_COLORS.failed}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function TokenTrendChart({
  series,
  empty,
  className,
}: {
  series: SeriesPoint[];
  empty: boolean;
  className?: string;
}) {
  const t = useTranslations("usage");
  const locale = useLocale();
  const points = tokenPoints(series).map((point) => ({
    ...point,
    label: formatDay(point.day, locale),
  }));
  const sum = (key: "input" | "output" | "cached") =>
    points.reduce((total, point) => total + point[key], 0);
  return (
    <ChartCard
      className={className}
      title={t("chartTokens")}
      summary={t("chartTokensSummary", {
        input: sum("input").toLocaleString(),
        output: sum("output").toLocaleString(),
        cached: sum("cached").toLocaleString(),
      })}
      table={
        <DataTable
          head={[t("colDay"), t("input"), t("output"), t("cached")]}
          rows={points.map((point) => [point.label, point.input, point.output, point.cached])}
        />
      }
    >
      {empty ? (
        <ChartEmpty message={t("emptyActivity")} />
      ) : (
        <div style={{ height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid
                vertical={false}
                stroke={GRID_STROKE}
                strokeOpacity={0.5}
                strokeDasharray="2 4"
              />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                dy={4}
                minTickGap={16}
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
                tickFormatter={(value: number) => formatCompact(value)}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    extraRows={(point) => [
                      { name: t("cached"), value: point.cached, color: USAGE_COLORS.cached },
                    ]}
                  />
                }
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              />
              <Legend {...legendProps(["input", "output"])} />
              <Bar
                dataKey="input"
                name={t("input")}
                stackId="tokens"
                fill={USAGE_COLORS.input}
                isAnimationActive={false}
              />
              <Bar
                dataKey="output"
                name={t("output")}
                stackId="tokens"
                fill={USAGE_COLORS.output}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

/** Ranked members as labelled horizontal bars, highest first. */
export function MemberBarChart({
  title,
  summary,
  ranked,
  valueLabel,
  color,
  emptyMessage,
  className,
}: {
  title: string;
  summary: string;
  ranked: RankedMember[];
  valueLabel: string;
  color: string;
  emptyMessage: string;
  className?: string;
}) {
  const t = useTranslations("usage");
  const height = Math.max(CHART_HEIGHT, ranked.length * 30 + 24);
  return (
    <ChartCard
      className={className}
      title={title}
      summary={summary}
      table={
        ranked.length > 0 ? (
          <DataTable
            head={[t("colMember"), valueLabel]}
            rows={ranked.map((entry) => [entry.email, entry.value])}
          />
        ) : undefined
      }
    >
      {ranked.length === 0 ? (
        <ChartEmpty message={emptyMessage} />
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={ranked}
              layout="vertical"
              margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
            >
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="email"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={150}
                tickFormatter={(email: string) =>
                  email.length > 22 ? `${email.slice(0, 21)}…` : email
                }
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
              <Bar
                dataKey="value"
                name={valueLabel}
                fill={color}
                radius={[0, 4, 4, 0]}
                barSize={16}
                isAnimationActive={false}
                label={{
                  position: "right",
                  fontSize: 11,
                  fill: "var(--foreground)",
                  formatter: (value: unknown) => formatCompact(Number(value)),
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
