/**
 * Shapes and pure derivations for the public team usage dashboard.
 *
 * The page renders whatever `/api/usage/team` returns; everything a chart or KPI
 * needs is computed here so it can be tested without rendering Recharts.
 */

export const USAGE_RANGES = ["today", "7d", "30d"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const OPERATIONS = ["retain", "recall", "reflect"] as const;
export type Operation = (typeof OPERATIONS)[number];

export type Activity = { success: number; failure: number };
export type Tokens = { input: number; output: number; cached_input: number };
export type Footprint = { banks: number; documents: number; memory_units: number };
export type SeriesPoint = {
  day: string;
  retain_success: number;
  retain_failure: number;
  recall_success: number;
  recall_failure: number;
  reflect_success: number;
  reflect_failure: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
};
export type UsageSlice = {
  activity: Record<Operation, Activity>;
  tokens: Tokens;
  footprint: Footprint;
  series: SeriesPoint[];
};
export type MemberUsage = UsageSlice & { email: string };
export type UsageBody = {
  range: UsageRange;
  snapshot_at: string | null;
  team: UsageSlice;
  members: MemberUsage[];
};

export type UsageSummary = {
  operations: number;
  failures: number;
  /** Failed share of all operations, or null when nothing ran. */
  failureRate: number | null;
  /** Input plus output tokens. */
  tokens: number;
  cachedInput: number;
  memoryUnits: number;
  documents: number;
  banks: number;
  activeMembers: number;
  totalMembers: number;
};

function count(activity: Activity | undefined): number {
  return (activity?.success ?? 0) + (activity?.failure ?? 0);
}

function operationTotal(slice: Pick<UsageSlice, "activity">): number {
  return OPERATIONS.reduce((sum, op) => sum + count(slice.activity[op]), 0);
}

function failureTotal(slice: Pick<UsageSlice, "activity">): number {
  return OPERATIONS.reduce((sum, op) => sum + (slice.activity[op]?.failure ?? 0), 0);
}

function tokenTotal(slice: Pick<UsageSlice, "tokens">): number {
  return slice.tokens.input + slice.tokens.output;
}

/** Whether anything was counted in range. Stored footprint alone is not activity. */
export function hasActivity(slice: UsageSlice): boolean {
  return operationTotal(slice) > 0 || tokenTotal(slice) > 0 || slice.tokens.cached_input > 0;
}

/** KPI values for `slice`; `members` are the people it covers (the team, or one member). */
export function summarize(slice: UsageSlice, members: MemberUsage[]): UsageSummary {
  const operations = operationTotal(slice);
  const failures = failureTotal(slice);
  return {
    operations,
    failures,
    failureRate: operations > 0 ? failures / operations : null,
    tokens: tokenTotal(slice),
    cachedInput: slice.tokens.cached_input,
    memoryUnits: slice.footprint.memory_units,
    documents: slice.footprint.documents,
    banks: slice.footprint.banks,
    activeMembers: members.filter(hasActivity).length,
    totalMembers: members.length,
  };
}

export type ActivityPoint = { day: string; failed: number } & Record<Operation, number>;

export function activityPoints(series: SeriesPoint[]): ActivityPoint[] {
  return series.map((point) => ({
    day: point.day,
    retain: point.retain_success + point.retain_failure,
    recall: point.recall_success + point.recall_failure,
    reflect: point.reflect_success + point.reflect_failure,
    failed: point.retain_failure + point.recall_failure + point.reflect_failure,
  }));
}

export type TokenPoint = { day: string; input: number; output: number; cached: number };

export function tokenPoints(series: SeriesPoint[]): TokenPoint[] {
  return series.map((point) => ({
    day: point.day,
    input: point.input_tokens,
    output: point.output_tokens,
    cached: point.cached_input_tokens,
  }));
}

export type MixPoint = { operation: Operation; success: number; failure: number };

export function operationMix(activity: Record<Operation, Activity>): MixPoint[] {
  return OPERATIONS.map((operation) => ({
    operation,
    success: activity[operation]?.success ?? 0,
    failure: activity[operation]?.failure ?? 0,
  }));
}

export type MemberMetric = "operations" | "tokens" | "memoryUnits";
export type RankedMember = { email: string; value: number };

function metricValue(member: MemberUsage, metric: MemberMetric): number {
  if (metric === "operations") return operationTotal(member);
  if (metric === "tokens") return tokenTotal(member);
  return member.footprint.memory_units;
}

/** Members with a non-zero `metric`, highest first, at most `limit`. */
export function rankMembers(
  members: MemberUsage[],
  metric: MemberMetric,
  limit = 10
): RankedMember[] {
  return members
    .map((member) => ({ email: member.email, value: metricValue(member, metric) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.email.localeCompare(b.email))
    .slice(0, limit);
}

export type MemberRow = {
  email: string;
  retain: number;
  recall: number;
  reflect: number;
  operations: number;
  failures: number;
  tokens: number;
  memoryUnits: number;
  documents: number;
  banks: number;
};
export type SortKey = keyof MemberRow;
export type SortDirection = "asc" | "desc";

export function memberRows(members: MemberUsage[]): MemberRow[] {
  return members.map((member) => ({
    email: member.email,
    retain: count(member.activity.retain),
    recall: count(member.activity.recall),
    reflect: count(member.activity.reflect),
    operations: operationTotal(member),
    failures: failureTotal(member),
    tokens: tokenTotal(member),
    memoryUnits: member.footprint.memory_units,
    documents: member.footprint.documents,
    banks: member.footprint.banks,
  }));
}

/** Sorted copy of `rows`. Equal values fall back to email so the order never jumps. */
export function sortRows(rows: MemberRow[], key: SortKey, direction: SortDirection): MemberRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    const primary =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : (left as number) - (right as number);
    return primary !== 0 ? primary * sign : a.email.localeCompare(b.email);
  });
}

function trim(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${trim(n / 1000)}k`;
  if (n < 1_000_000_000) return `${trim(n / 1_000_000)}M`;
  return `${trim(n / 1_000_000_000)}B`;
}
