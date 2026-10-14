"use client";

// ccc(home): Home A2 — stats strip with sparklines and the constellation legend
// (WAI-1005). Composed by src/components/home-view.tsx through one anchored
// block; this file owns the data fetch, the drawing and the styles. Upstream
// Constellation and TreeRow are untouched. No new i18n keys: labels come from
// `home.*`, `staleness.stale`, `documentsView.dateRangeLast7Days`,
// `auditLogsView.periodToday`.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { client, type KnowledgeNode } from "@/lib/api";
import type { BankStats } from "@/components/bank-stats-view";
import type { GraphData } from "@/components/graph-data";
import "./home.css";

type Bucket = { time: string; world: number; experience: number; observation: number };
type DocLike = { id?: string; created_at?: string | null };

const SERIES_VARS: Record<string, string> = {
  world: "--ccc-blue",
  experience: "--ccc-blue-deep",
  observation: "--ccc-ink-3",
  entity: "--ccc-ink-4",
};
const SERIES_ORDER = ["world", "experience", "observation", "entity"];

/** Series colors from the theme tokens, re-read when the `.dark` class flips.
 *  The canvas needs plain color strings, so this is the one place the home view
 *  turns tokens into hex. Orange is never a series. */
export function useSeriesColors(): Record<string, string> {
  const read = () => {
    if (typeof window === "undefined") return {} as Record<string, string>;
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(SERIES_VARS))
      out[key] = cs.getPropertyValue(v).trim() || "#3179f5";
    return out;
  };
  const [colors, setColors] = useState<Record<string, string>>(read);
  useEffect(() => {
    setColors(read());
    const mo = new MutationObserver(() => setColors(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return colors;
}

/** 100×28 viewBox paths for a tiny series: the line and the closed area under it. */
function sparkPaths(values: number[]): { line: string; area: string } | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 25 - ((v - min) / span) * 21; // 4px head room, 3px foot
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  return { line, area: `${line} L100 28 L0 28Z` };
}

function Spark({ values }: { values: number[] }) {
  const p = sparkPaths(values);
  if (!p) return <div className="ccc-spark ccc-spark--empty" aria-hidden="true" />;
  return (
    <svg className="ccc-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <path className="ccc-spark__area" d={p.area} />
      <path d={p.line} />
    </svg>
  );
}

function Stat({
  label,
  value,
  delta,
  dir,
  series,
}: {
  label: string;
  value: number;
  delta?: string;
  dir?: "up" | "down";
  series: number[];
}) {
  return (
    <div className="ccc-stat">
      <div className="ccc-stat__label">{label}</div>
      <div className="ccc-stat__value">{value.toLocaleString()}</div>
      <div className="ccc-stat__delta" data-dir={dir}>
        {delta ?? " "}
      </div>
      <Spark values={series} />
    </div>
  );
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function HomeStatsStrip({
  bankId,
  stats,
  pages,
  docs,
  observationsEnabled,
}: {
  bankId: string;
  stats: BankStats | null;
  pages: KnowledgeNode[];
  docs: DocLike[];
  observationsEnabled: boolean;
}) {
  const t = useTranslations("home");
  const tStale = useTranslations("staleness");
  const tDocs = useTranslations("documentsView");
  const tAudit = useTranslations("auditLogsView");
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  // One small request: the last 7 days by ingest time, same endpoint the bank
  // stats chart uses. It never blocks the page; the strip paints with the
  // totals first and the sparklines fill in.
  useEffect(() => {
    let cancelled = false;
    client
      .getMemoriesTimeseries(bankId, "7d", "created_at")
      .then((r) => {
        if (!cancelled) setBuckets(r.buckets || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bankId]);

  const mem = useMemo(
    () => buckets.map((b) => (b.world || 0) + (b.experience || 0) + (b.observation || 0)),
    [buckets]
  );
  const obs = useMemo(() => buckets.map((b) => b.observation || 0), [buckets]);
  const memWeek = mem.reduce((a, b) => a + b, 0);
  const obsWeek = obs.reduce((a, b) => a + b, 0);
  const stale = pages.filter((p) => p.is_stale).length;
  const docsToday = docs.filter((d) => isToday(d.created_at)).length;
  const week = tDocs("dateRangeLast7Days");

  if (!stats) return null;
  return (
    <div className="ccc-stats" role="list" aria-label={t("title")}>
      <Stat
        label={t("statMemories")}
        value={stats.total_nodes || 0}
        delta={memWeek > 0 ? `${memWeek.toLocaleString()} · ${week}` : undefined}
        dir={memWeek > 0 ? "up" : undefined}
        series={mem}
      />
      {observationsEnabled && (
        <Stat
          label={t("statObservations")}
          value={stats.total_observations || 0}
          delta={obsWeek > 0 ? `${obsWeek.toLocaleString()} · ${week}` : undefined}
          dir={obsWeek > 0 ? "up" : undefined}
          series={obs}
        />
      )}
      <Stat
        label={t("statPages")}
        value={pages.length}
        delta={stale > 0 ? `${stale} ${tStale("stale")}` : undefined}
        dir={stale > 0 ? "down" : undefined}
        series={[]}
      />
      <Stat
        label={t("statDocuments")}
        value={stats.total_documents || 0}
        delta={docsToday > 0 ? `${docsToday} · ${tAudit("periodToday")}` : undefined}
        series={[]}
      />
    </div>
  );
}

/** Footer under the home map: the fact types in view with their counts in the
 *  series colors, and how much of the bank the capped map shows. */
export function ConstellationLegend({ data, total }: { data: GraphData; total: number }) {
  const colors = useSeriesColors();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of data.nodes) {
      const k = n.group || "world";
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [data]);
  const keys = SERIES_ORDER.filter((k) => counts[k]).concat(
    Object.keys(counts).filter((k) => !SERIES_ORDER.includes(k))
  );
  if (!data.nodes.length) return null;
  return (
    <div className="ccc-mapfoot">
      <div className="ccc-mapfoot__mix">
        {keys.map((k) => (
          <span key={k} style={{ ["--c" as string]: colors[k] || colors.world }}>
            {k} <b>{(counts[k] || 0).toLocaleString()}</b>
          </span>
        ))}
      </div>
      <span className="ccc-mapfoot__meta">
        {data.nodes.length.toLocaleString()} / {Math.max(total, data.nodes.length).toLocaleString()}
      </span>
    </div>
  );
}
