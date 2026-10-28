"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";

type Activity = { success: number; failure: number };
type Tokens = { input: number; output: number; cached_input: number };
type Footprint = { banks: number; documents: number; memory_units: number };
type SeriesPoint = {
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
type UsageSlice = { activity: Record<string, Activity>; tokens: Tokens; footprint: Footprint; series: SeriesPoint[] };
type UsageBody = { range: string; snapshot_at: string | null; team: UsageSlice; members: Array<UsageSlice & { email: string }> };

const RANGES = ["today", "7d", "30d"] as const;

export default function UsagePage() {
  const t = useTranslations("usage");
  const [range, setRange] = useState<(typeof RANGES)[number]>("7d");
  const [body, setBody] = useState<UsageBody | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "disabled" | "error">("loading");

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

  const rangeLabel = { today: t("rangeToday"), "7d": t("range7d"), "30d": t("range30d") };

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <div className="flex gap-2">
            {RANGES.map((id) => (
              <Button key={id} type="button" variant={id === range ? "default" : "outline"} onClick={() => setRange(id)}>
                {rangeLabel[id]}
              </Button>
            ))}
          </div>
        </div>
        {status === "disabled" ? <p>{t("notEnabled")}</p> : null}
        {status === "error" ? <p>{t("unavailable")}</p> : null}
        {status === "ready" && body ? (
          <>
            {body.snapshot_at ? <p className="text-sm text-muted-foreground">{t("snapshot", { time: body.snapshot_at })}</p> : null}
            <UsageBlock title={t("team")} slice={body.team} />
            <div className="space-y-4">
              {body.members.map((member) => (
                <UsageBlock key={member.email} title={member.email} slice={member} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function UsageBlock({ title, slice }: { title: string; slice: UsageSlice }) {
  const t = useTranslations("usage");
  const operations = ["retain", "recall", "reflect"] as const;
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <h2 className="text-lg font-medium">{title}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th>{t("activity")}</th>
            <th>{t("succeeded")}</th>
            <th>{t("failed")}</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((name) => (
            <tr key={name}>
              <td>{t(name)}</td>
              <td>{slice.activity[name]?.success ?? 0}</td>
              <td>{slice.activity[name]?.failure ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {t("tokens")}: {t("input")} {slice.tokens.input}, {t("output")} {slice.tokens.output}, {t("cached")}{" "}
        {slice.tokens.cached_input}
      </p>
      <p>
        {t("stored")}: {t("banks")} {slice.footprint.banks}, {t("documents")} {slice.footprint.documents},{" "}
        {t("memoryUnits")} {slice.footprint.memory_units}
      </p>
      <details>
        <summary>{t("daily")}</summary>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>{t("daily")}</th>
              <th>{t("retain")}</th>
              <th>{t("recall")}</th>
              <th>{t("reflect")}</th>
              <th>{t("tokens")}</th>
            </tr>
          </thead>
          <tbody>
            {slice.series.map((point) => (
              <tr key={point.day}>
                <td>{point.day}</td>
                <td>{point.retain_success + point.retain_failure}</td>
                <td>{point.recall_success + point.recall_failure}</td>
                <td>{point.reflect_success + point.reflect_failure}</td>
                <td>{point.input_tokens + point.output_tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
