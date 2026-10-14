"use client";

// ccc(constellation): the horizon-ring memory constellation (WAI-1055).
// Drop-in for the upstream Constellation props: data, colors, heat, sizes and
// cluster keys are honoured; the drawing is the horizon ring from the approved
// plate-06 design. Brightness follows bank activity (reflect / consolidation)
// polled from the bank stats. Upstream i18n keys only (`constellation.*`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { client } from "@/lib/api";
import { useBank } from "@/lib/bank-context";
import type { GraphNode } from "@/components/graph-data";
import type { ConstellationProps } from "@/components/constellation";
import {
  buildFromGraph,
  mount,
  linkColor,
  rampCSS,
  type HorizonHandle,
  type HorizonGraph,
  type HorizonState,
} from "./horizon-engine";
import "./constellation.css";

export const HORIZON_STORAGE_KEY = "ccc-constellation";
/** `localStorage["ccc-constellation"] = "legacy"` restores the upstream renderer. */
export function horizonEnabled(): boolean {
  try {
    return localStorage.getItem(HORIZON_STORAGE_KEY) !== "legacy";
  } catch {
    return true;
  }
}

export interface HorizonExtras {
  /** Node-count control for views that can refetch (the Memories view). */
  cccLimit?: { value: number; options?: number[]; onChange: (n: number) => void };
}

const DEFAULT_OPTIONS = [1000, 2000, 5000, 10000];
const ACTIVITY_POLL_MS = 20000;

/** 0 idle · .7 reflect/other operations pending · 1 consolidation pending. */
function activityFromStats(
  s: { pending_operations?: number; pending_consolidation?: number } | null
): number {
  if (!s) return 0;
  if ((s.pending_consolidation || 0) > 0) return 1;
  if ((s.pending_operations || 0) > 0) return 0.7;
  return 0;
}

export function HorizonConstellation({
  data,
  height = 700,
  onNodeClick,
  nodeColorFn,
  nodeSizeFn,
  nodeHeatFn,
  heatLegendLabel,
  heatLegendEndpoints,
  clusterKeyFn,
  clusterColorFn,
  nodeGroupsFn,
  cccLimit,
}: ConstellationProps & HorizonExtras) {
  const t = useTranslations("constellation");
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HorizonHandle | null>(null);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hud, setHud] = useState("");
  const { currentBank } = useBank();

  const graph = useMemo<HorizonGraph>(() => {
    const key = (n: GraphNode) =>
      nodeGroupsFn ? nodeGroupsFn(n)[0] : clusterKeyFn ? clusterKeyFn(n) : n.group;
    // no recency ramp → colour by cluster (fact type on Home), as upstream does
    const color =
      nodeColorFn ||
      (!nodeHeatFn && clusterColorFn
        ? (n: GraphNode) => {
            const k = key(n);
            return k == null ? null : clusterColorFn(String(k));
          }
        : undefined);
    return buildFromGraph(data, { heat: nodeHeatFn, key, color, size: nodeSizeFn });
  }, [data, nodeHeatFn, clusterKeyFn, clusterColorFn, nodeGroupsFn, nodeColorFn, nodeSizeFn]);

  const showTip = useCallback((node: GraphNode | null, e?: PointerEvent) => {
    const tip = tipRef.current,
      wrap = wrapRef.current;
    if (!tip || !wrap) return;
    if (!node || !e) {
      tip.removeAttribute("data-open");
      return;
    }
    const r = wrap.getBoundingClientRect();
    tip.textContent = node.label || node.id;
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 300) + "px";
    tip.style.top = e.clientY - r.top + 14 + "px";
    tip.setAttribute("data-open", "true");
  }, []);

  // mount once; swap graphs in place
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let lastHud = 0;
    const h = mount(host, graph, {
      onHover: showTip,
      onSelect: (n) => onNodeClick?.(n),
      onFrame: (s: HorizonState, g: HorizonGraph) => {
        const now = performance.now();
        if (now - lastHud < 300) return;
        lastHud = now;
        setHud(
          t("hudStats", {
            memories: g.N.toLocaleString(),
            visible: s.drawn.toLocaleString(),
            labels: s.labels,
            links: g.L.toLocaleString(),
            zoom: s.k.toFixed(2),
          })
        );
      },
    });
    handleRef.current = h;
    return () => {
      h.destroy();
      handleRef.current = null;
    };
  }, []);
  useEffect(() => {
    handleRef.current?.setGraph(graph);
  }, [graph]);
  useEffect(() => {
    handleRef.current?.pause(paused);
  }, [paused]);

  // activity feed: reflect / consolidation pending → brighter heartbeat
  useEffect(() => {
    if (!currentBank) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = (await client.getBankStats(currentBank)) as {
          pending_operations?: number;
          pending_consolidation?: number;
        };
        if (!cancelled) handleRef.current?.activity(activityFromStats(s));
      } catch {
        /* keep the last level */
      }
    };
    tick();
    const id = setInterval(() => {
      if (!document.hidden) tick();
    }, ACTIVITY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentBank]);

  // fullscreen
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrapRef.current?.requestFullscreen?.().catch(() => {});
  };
  const share = () => {
    const h = handleRef.current;
    if (!h) return;
    const a = document.createElement("a");
    a.href = h.png();
    a.download = "memory-constellation.png";
    a.click();
  };

  const hasHeat = !!nodeHeatFn;
  return (
    <div
      ref={wrapRef}
      className="ccc-cv"
      style={{ height: fullscreen ? "100vh" : height }}
      data-ccc-constellation
    >
      <div ref={hostRef} className="ccc-cv__host" />
      <div className="ccc-cv__hint">{t("instructions")}</div>
      <div className="ccc-cv__tools">
        {cccLimit && (
          <div className="ccc-seg" role="group">
            {(cccLimit.options || DEFAULT_OPTIONS).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={cccLimit.value === n}
                onClick={() => cccLimit.onChange(n)}
              >
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="ccc-btn" title={t("exportSvgTitle")} onClick={share}>
          {t("exportSvgLabel")}
        </button>
        <button
          type="button"
          className="ccc-btn"
          aria-pressed={paused}
          title={paused ? t("resumeMotionTitle") : t("pauseMotionTitle")}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? t("resumeMotionLabel") : t("pauseMotionLabel")}
        </button>
        <button
          type="button"
          className="ccc-btn"
          title={fullscreen ? t("exitFullscreenTitle") : t("enterFullscreenTitle")}
          onClick={toggleFullscreen}
        >
          {fullscreen ? t("exitFullscreenLabel") : t("enterFullscreenLabel")}
        </button>
      </div>
      <div className="ccc-cv__hud">{hud}</div>
      <div className="ccc-cv__legend">
        {hasHeat && (
          <span className="ccc-cv__ramp">
            <span className="ccc-cv__lbl">{heatLegendLabel || t("legendLinks")}</span>
            <span className="ccc-cv__ends">{heatLegendEndpoints?.[0] || t("legendFew")}</span>
            <i style={{ background: rampCSS() }} />
            <span className="ccc-cv__ends">{heatLegendEndpoints?.[1] || t("legendMany")}</span>
          </span>
        )}
        <span className="ccc-cv__lk">
          {(["semantic", "temporal", "entity", "causal"] as const).map((k) => (
            <i key={k} style={{ ["--c" as string]: linkColor(k) }}>
              {t(`linkType${k[0].toUpperCase()}${k.slice(1)}` as "linkTypeSemantic")}
            </i>
          ))}
        </span>
      </div>
      <div ref={tipRef} className="ccc-cv__tip" />
    </div>
  );
}
