import { describe, expect, it } from "vitest";

import {
  activityPoints,
  formatCompact,
  hasActivity,
  memberRows,
  operationMix,
  rankMembers,
  sortRows,
  summarize,
  tokenPoints,
  type MemberUsage,
  type SeriesPoint,
  type UsageSlice,
} from "@/lib/usage-dashboard";

function point(day: string, values: Partial<SeriesPoint> = {}): SeriesPoint {
  return {
    day,
    retain_success: 0,
    retain_failure: 0,
    recall_success: 0,
    recall_failure: 0,
    reflect_success: 0,
    reflect_failure: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    ...values,
  };
}

function slice(overrides: Partial<UsageSlice> = {}): UsageSlice {
  return {
    activity: {
      retain: { success: 0, failure: 0 },
      recall: { success: 0, failure: 0 },
      reflect: { success: 0, failure: 0 },
    },
    tokens: { input: 0, output: 0, cached_input: 0 },
    footprint: { banks: 0, documents: 0, memory_units: 0 },
    series: [],
    ...overrides,
  };
}

function member(email: string, overrides: Partial<UsageSlice> = {}): MemberUsage {
  return { email, ...slice(overrides) };
}

const busy = member("busy@example.com", {
  activity: {
    retain: { success: 6, failure: 1 },
    recall: { success: 10, failure: 0 },
    reflect: { success: 2, failure: 1 },
  },
  tokens: { input: 900, output: 100, cached_input: 300 },
  footprint: { banks: 2, documents: 5, memory_units: 40 },
});
const quiet = member("quiet@example.com", {
  activity: {
    retain: { success: 1, failure: 0 },
    recall: { success: 0, failure: 0 },
    reflect: { success: 0, failure: 0 },
  },
  tokens: { input: 10, output: 5, cached_input: 0 },
  footprint: { banks: 1, documents: 1, memory_units: 90 },
});
const idle = member("idle@example.com", { footprint: { banks: 1, documents: 0, memory_units: 0 } });

describe("summarize", () => {
  it("totals operations, failures, tokens, footprint and active members", () => {
    const team = slice({
      activity: {
        retain: { success: 7, failure: 1 },
        recall: { success: 10, failure: 0 },
        reflect: { success: 2, failure: 1 },
      },
      tokens: { input: 910, output: 105, cached_input: 300 },
      footprint: { banks: 4, documents: 6, memory_units: 130 },
    });
    const summary = summarize(team, [busy, quiet, idle]);
    expect(summary.operations).toBe(21);
    expect(summary.failures).toBe(2);
    expect(summary.failureRate).toBeCloseTo(2 / 21);
    expect(summary.tokens).toBe(1015);
    expect(summary.cachedInput).toBe(300);
    expect(summary.memoryUnits).toBe(130);
    expect(summary.documents).toBe(6);
    expect(summary.banks).toBe(4);
    expect(summary.activeMembers).toBe(2);
    expect(summary.totalMembers).toBe(3);
  });

  it("reports no failure rate when nothing ran", () => {
    expect(summarize(slice(), [idle]).failureRate).toBeNull();
  });
});

describe("hasActivity", () => {
  it("is false when every counter is zero, even with stored memory", () => {
    expect(hasActivity(idle)).toBe(false);
  });

  it("is true for operations or tokens alone", () => {
    expect(hasActivity(quiet)).toBe(true);
    expect(hasActivity(slice({ tokens: { input: 1, output: 0, cached_input: 0 } }))).toBe(true);
  });
});

describe("chart points", () => {
  const series = [
    point("2026-10-27", { retain_success: 2, retain_failure: 1, recall_success: 4, input_tokens: 50 }),
    point("2026-10-28", { reflect_success: 1, reflect_failure: 2, output_tokens: 7, cached_input_tokens: 3 }),
  ];

  it("sums success and failure per operation per day", () => {
    expect(activityPoints(series)).toEqual([
      { day: "2026-10-27", retain: 3, recall: 4, reflect: 0, failed: 1 },
      { day: "2026-10-28", retain: 0, recall: 0, reflect: 3, failed: 2 },
    ]);
  });

  it("keeps input, output and cached tokens per day", () => {
    expect(tokenPoints(series)).toEqual([
      { day: "2026-10-27", input: 50, output: 0, cached: 0 },
      { day: "2026-10-28", input: 0, output: 7, cached: 3 },
    ]);
  });

  it("splits each operation into succeeded and failed", () => {
    expect(operationMix(busy.activity)).toEqual([
      { operation: "retain", success: 6, failure: 1 },
      { operation: "recall", success: 10, failure: 0 },
      { operation: "reflect", success: 2, failure: 1 },
    ]);
  });
});

describe("rankMembers", () => {
  it("orders by the metric, drops zeros and caps the list", () => {
    expect(rankMembers([quiet, idle, busy], "operations")).toEqual([
      { email: "busy@example.com", value: 20 },
      { email: "quiet@example.com", value: 1 },
    ]);
    expect(rankMembers([busy, quiet, idle], "memoryUnits", 1)).toEqual([
      { email: "quiet@example.com", value: 90 },
    ]);
  });

  it("caps at ten members by default", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      member(`m${String(i).padStart(2, "0")}@example.com`, {
        tokens: { input: i + 1, output: 0, cached_input: 0 },
      })
    );
    const ranked = rankMembers(many, "tokens");
    expect(ranked).toHaveLength(10);
    expect(ranked[0]).toEqual({ email: "m11@example.com", value: 12 });
  });
});

describe("member rows", () => {
  const rows = memberRows([quiet, busy, idle]);

  it("flattens each member's totals", () => {
    expect(rows.find((row) => row.email === "busy@example.com")).toEqual({
      email: "busy@example.com",
      retain: 7,
      recall: 10,
      reflect: 3,
      operations: 20,
      failures: 2,
      tokens: 1000,
      memoryUnits: 40,
      documents: 5,
      banks: 2,
    });
  });

  it("sorts numbers and emails in both directions", () => {
    expect(sortRows(rows, "operations", "desc").map((row) => row.email)).toEqual([
      "busy@example.com",
      "quiet@example.com",
      "idle@example.com",
    ]);
    expect(sortRows(rows, "memoryUnits", "asc").map((row) => row.email)).toEqual([
      "idle@example.com",
      "busy@example.com",
      "quiet@example.com",
    ]);
    expect(sortRows(rows, "email", "asc").map((row) => row.email)).toEqual([
      "busy@example.com",
      "idle@example.com",
      "quiet@example.com",
    ]);
  });

  it("breaks ties by email so the order is stable", () => {
    const tied = memberRows([member("b@example.com"), member("a@example.com")]);
    expect(sortRows(tied, "operations", "desc").map((row) => row.email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});

describe("formatCompact", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1200, "1.2k"],
    [15_400, "15k"],
    [2_000_000, "2M"],
    [3_450_000_000, "3.5B"],
  ])("formats %d as %s", (value, expected) => {
    expect(formatCompact(value)).toBe(expected);
  });
});
