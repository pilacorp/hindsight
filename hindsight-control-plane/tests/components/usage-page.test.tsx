// @vitest-environment jsdom
/**
 * The public usage page: every fetch outcome lands on its own state, an empty
 * ledger says so instead of drawing flat charts, and the member table drives both
 * its own sort order and the member filter the charts read from.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { MemberUsage, SeriesPoint, UsageBody, UsageSlice } from "@/lib/usage-dashboard";

vi.mock("next-intl", () => ({
  // Keys are echoed back; ICU arguments are appended so values stay assertable.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
  useLocale: () => "en",
  useFormatter: () => ({ relativeTime: () => "just now" }),
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  // jsdom has no layout, so the responsive wrapper would measure 0x0 and draw nothing.
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 800, height: 220 })
        : null,
  };
});

const { default: UsagePage } = await import("@/app/[locale]/usage/page");

function point(day: string, retain: number): SeriesPoint {
  return {
    day,
    retain_success: retain,
    retain_failure: 0,
    recall_success: 0,
    recall_failure: 0,
    reflect_success: 0,
    reflect_failure: 0,
    input_tokens: retain * 10,
    output_tokens: retain,
    cached_input_tokens: 0,
  };
}

function slice(retain: number, memoryUnits: number, days = 7): UsageSlice {
  return {
    activity: {
      retain: { success: retain, failure: 0 },
      recall: { success: 0, failure: 0 },
      reflect: { success: 0, failure: 0 },
    },
    tokens: { input: retain * 10, output: retain, cached_input: 0 },
    footprint: { banks: 1, documents: 1, memory_units: memoryUnits },
    series: Array.from({ length: days }, (_, i) => point(`2026-10-${String(20 + i).padStart(2, "0")}`, i === 0 ? retain : 0)),
  };
}

function member(email: string, retain: number, memoryUnits: number): MemberUsage {
  return { email, ...slice(retain, memoryUnits) };
}

function body(members: MemberUsage[]): UsageBody {
  const retain = members.reduce((sum, m) => sum + m.activity.retain.success, 0);
  const units = members.reduce((sum, m) => sum + m.footprint.memory_units, 0);
  return { range: "7d", snapshot_at: "2026-10-27T00:00:00Z", team: slice(retain, units), members };
}

function respond(status: number, payload?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: async () => payload,
    })
  );
}

/** The sortable member table; chart data tables share the page but have no sort buttons. */
function memberTable(): HTMLElement {
  return screen.getByRole("button", { name: /colDocuments/ }).closest("table") as HTMLElement;
}

/** Emails in the member table, top to bottom. */
function tableEmails(): string[] {
  const rows = within(memberTable()).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UsagePage", () => {
  it("shows a busy skeleton until the response arrives", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const { container } = render(<UsagePage />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("loading")).toBeTruthy();
  });

  it("explains that usage is off when the API returns 404", async () => {
    respond(404);
    render(<UsagePage />);
    expect(await screen.findByText("notEnabled")).toBeTruthy();
  });

  it("reports the dashboard as unavailable on a server error", async () => {
    respond(503);
    render(<UsagePage />);
    expect(await screen.findByText("unavailable")).toBeTruthy();
  });

  it("says nothing was counted instead of drawing empty charts", async () => {
    respond(200, body([member("a@pila.vn", 0, 0)]));
    render(<UsagePage />);
    const messages = await screen.findAllByText("emptyActivity");
    expect(messages.length).toBeGreaterThan(0);
    expect(screen.getByText("emptyStored")).toBeTruthy();
  });

  it("re-sorts the member table when a column header is chosen", async () => {
    respond(200, body([member("busy@pila.vn", 9, 1), member("quiet@pila.vn", 1, 50)]));
    render(<UsagePage />);
    await screen.findByText("membersTitle");

    const operations = within(memberTable()).getByRole("columnheader", { name: /colOperations/ });
    expect(operations.getAttribute("aria-sort")).toBe("descending");
    expect(tableEmails()).toEqual(["busy@pila.vn", "quiet@pila.vn"]);

    const units = within(memberTable()).getByRole("columnheader", { name: /colMemoryUnits/ });
    fireEvent.click(within(units).getByRole("button"));
    expect(units.getAttribute("aria-sort")).toBe("descending");
    expect(operations.getAttribute("aria-sort")).toBe("none");
    expect(tableEmails()).toEqual(["quiet@pila.vn", "busy@pila.vn"]);

    fireEvent.click(within(units).getByRole("button"));
    expect(units.getAttribute("aria-sort")).toBe("ascending");
    expect(tableEmails()).toEqual(["busy@pila.vn", "quiet@pila.vn"]);
  });

  it("filters the dashboard to one member and back to the team", async () => {
    respond(200, body([member("busy@pila.vn", 9, 1), member("quiet@pila.vn", 1, 50)]));
    render(<UsagePage />);
    await screen.findByText("membersTitle");
    expect(screen.queryByText(/^showingMember/)).toBeNull();
    expect(screen.getByText("kpiActiveMembersHint:2")).toBeTruthy();

    const table = memberTable();
    fireEvent.click(within(table).getByRole("button", { name: "quiet@pila.vn" }));
    expect(screen.getByText(/showingMember:quiet@pila\.vn/)).toBeTruthy();
    expect(screen.getByText("kpiActiveMembersHint:1")).toBeTruthy();
    expect(within(table).getByRole("button", { name: "quiet@pila.vn" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(table).getByRole("button", { name: "quiet@pila.vn" }));
    await waitFor(() => expect(screen.queryByText(/showingMember/)).toBeNull());
    expect(screen.getByText("kpiActiveMembersHint:2")).toBeTruthy();
  });
});
