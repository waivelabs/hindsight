/* ccc(constellation): horizon-ring engine for the memory constellation (WAI-1055).
 *
 * Port of cortana-v3/lanes/waive-theme-20261013/design/cortana-graph.js v3 to an ES
 * module that lays out REAL graph data: an open ring of memory clusters, oldest on
 * the left sweeping over the top to the newest on the right, filaments that follow
 * the ring, a dark void in the middle. Node color = recency ramp (heat) or the
 * caller's node color; link color = link type (semantic / temporal / entity /
 * causal) in the Waive palette. Canvas 2D, typed arrays, color-bucketed draws, one
 * edge layer at half rate, GPU blur bloom, slow orbit, heartbeat driven by bank
 * activity. Built for 1k–10k nodes.
 */
/* global document, matchMedia, devicePixelRatio, performance, requestAnimationFrame, ResizeObserver, MutationObserver, IntersectionObserver */

const reduceMotion =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEPS = 24;
const TYPES = ["semantic", "temporal", "entity", "causal"];
const R = 300,
  A = R * 1.32,
  B = R * 0.5,
  ROT = -0.08,
  CIRC = 1856,
  CR = Math.cos(ROT),
  SR = Math.sin(ROT);

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}
export function palette() {
  return isDark()
    ? {
        ramp: ["#1E3F86", "#3179F5", "#7FB0FF", "#D6DDF0", "#FFB454", "#FF8A3D"],
        link: { semantic: "#3179F5", temporal: "#5E6AD2", entity: "#FF8A3D", causal: "#E9EEF7" },
        ink: "#E9EEF7",
        ink3: "#8593AB",
        bg: "#161B26",
        glow: 0.9,
        edgeA: 0.22,
        bokeh: 0.08,
        dust: 0.6,
        nodeA: 0.6,
        blend: "lighter",
        bloomBlend: "lighter",
        bloom: 0.45,
        hot: [255, 244, 224],
      }
    : {
        ramp: ["#0D43AA", "#3179F5", "#7AA7F8", "#C2628C", "#FF7A1A", "#E65100"],
        link: { semantic: "#3179F5", temporal: "#5E6AD2", entity: "#FF7A1A", causal: "#0F172A" },
        ink: "#0F172A",
        ink3: "#6B7790",
        bg: "#FFFFFF",
        glow: 0.35,
        edgeA: 0.2,
        bokeh: 0.07,
        dust: 0.5,
        nodeA: 0.9,
        blend: "source-over",
        bloomBlend: "multiply",
        bloom: 0.22,
        hot: [255, 255, 255],
      };
}
export const linkColor = (t) => palette().link[t];
export const rampCSS = () => "linear-gradient(90deg," + palette().ramp.join(",") + ")";

function hex(h) {
  if (!h || h[0] !== "#") return [128, 140, 160];
  const s = h.length === 4 ? "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h;
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1,
    i = Math.min(n - 1, Math.floor(t * n)),
    f = t * n - i,
    a = hex(stops[i]),
    b = hex(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const rgba = (c, a) => "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a + ")";
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const gauss = (r) => (r() + r() + r() - 1.5) / 1.5;
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function ring(u, off, out) {
  const p = Math.PI + u * 6.2832,
    x0 = A * (1 + off) * Math.cos(p),
    y0 = B * (1 + off) * Math.sin(p);
  out[0] = x0 * CR - y0 * SR;
  out[1] = x0 * SR + y0 * CR;
  return out;
}
const depth = (u) => (Math.sin(Math.PI + u * 6.2832) + 1) / 2;
const wrap = (u) => ((u % 1) + 1) % 1;
function linkTypeCode(t) {
  if (t === "temporal") return 1;
  if (t === "entity") return 2;
  if (t === "causes" || t === "caused_by" || t === "enables" || t === "prevents" || t === "causal")
    return 3;
  return 0;
}

/**
 * Lay out real graph data on the horizon ring.
 * @param {{nodes:Array, links:Array}} data   Hindsight GraphData (ids, labels, groups, link types)
 * @param {{heat?:(n)=>number|null, key?:(n)=>string|null, color?:(n)=>string, size?:(n)=>number, maxEdges?:number}} opts
 */
export function buildFromGraph(data, opts = {}) {
  const nodes = data.nodes || [];
  const N = nodes.length;
  const index = new Map();
  nodes.forEach((n, i) => index.set(n.id, i));
  // links → typed arrays, capped by weight when the payload is huge
  let raw = (data.links || []).filter(
    (l) => index.has(l.source) && index.has(l.target) && l.source !== l.target
  );
  const maxEdges = opts.maxEdges || 80000;
  if (raw.length > maxEdges)
    raw = raw
      .slice()
      .sort((p, q) => (q.weight || 0) - (p.weight || 0))
      .slice(0, maxEdges);
  const L = raw.length;
  const deg = new Float32Array(N);
  for (const l of raw) {
    deg[index.get(l.source)]++;
    deg[index.get(l.target)]++;
  }
  let maxd = 1;
  for (let i = 0; i < N; i++) maxd = Math.max(maxd, deg[i]);
  // recency (heat) and cluster key per node
  const heat = new Float32Array(N);
  const hasHeat = new Uint8Array(N);
  const keys = new Array(N);
  const ecol = new Array(N);
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    const h = opts.heat ? opts.heat(n) : null;
    if (typeof h === "number" && Number.isFinite(h)) {
      heat[i] = Math.max(0, Math.min(1, h));
      hasHeat[i] = 1;
    } else heat[i] = 0.5;
    const k = opts.key ? opts.key(n) : n.group || null;
    keys[i] = k == null ? "" : String(k);
    ecol[i] = opts.color ? opts.color(n) : n.color || null;
  }
  // rank by recency → ring parameter; two strands (over the top and along the
  // bottom), both running oldest-left → newest-right, so x reads as time.
  const order = new Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort(
    (p, q) => heat[p] - heat[q] || (hash32(nodes[p].id) % 1000) - (hash32(nodes[q].id) % 1000)
  );
  const rank = new Float32Array(N);
  for (let r = 0; r < N; r++) rank[order[r]] = N > 1 ? r / (N - 1) : 0.5;
  // clusters per strand (plate: ~8 + sqrt(N)/7 around the whole ring)
  const K = Math.max(4, Math.min(24, Math.round((8 + Math.sqrt(N) / 7) / 2)));
  // loose nodes: the least-connected 8% ride the filaments between clusters
  const looseN = Math.floor(N * 0.08);
  const loose = new Uint8Array(N);
  if (looseN) {
    const byDeg = order
      .slice()
      .sort((p, q) => deg[p] - deg[q] || hash32(nodes[p].id) - hash32(nodes[q].id));
    for (let i = 0; i < looseN; i++) loose[byDeg[i]] = 1;
  }
  const nu = new Float32Array(N),
    noff = new Float32Array(N),
    ndt = new Float32Array(N),
    ndn = new Float32Array(N),
    u = new Float32Array(N),
    ph = new Float32Array(N),
    cl = new Uint16Array(N),
    hub = new Uint8Array(N),
    ox = new Float32Array(N),
    oy = new Float32Array(N);
  // bins: (strand, bin) → cluster. Same key → same strand so a topic stays together.
  const binOf = new Int32Array(N);
  const bins = new Map();
  // a topic keeps one strand — unless there are so few topics (fact types on
  // Home) that this would leave a strand empty; then split by id.
  const distinct = new Set(keys).size;
  for (let i = 0; i < N; i++) {
    const strand = (keys[i] && distinct >= 6 ? hash32(keys[i]) : hash32(nodes[i].id)) & 1;
    const b = Math.min(K - 1, Math.floor(rank[i] * K));
    const id = strand * K + b;
    binOf[i] = id;
    if (!bins.has(id)) bins.set(id, { id, strand, b, members: [], groups: new Map() });
    const bin = bins.get(id);
    bin.members.push(i);
    if (!bin.groups.has(keys[i])) bin.groups.set(keys[i], []);
    bin.groups.get(keys[i]).push(i);
  }
  const clusters = [];
  const hubs = [],
    subhubs = [];
  let cidx = 0;
  for (const bin of bins.values()) {
    const r = rng(hash32("bin" + bin.id) ^ 0x9e3779b9);
    const rc = (bin.b + 0.5) / K;
    const uc = bin.strand === 0 ? 0.5 * rc : 1 - 0.5 * rc;
    const coff = gauss(r) * 0.11;
    const d = depth(uc),
      sc = 0.7 + 0.5 * d;
    const w = Math.sqrt(bin.members.length / Math.max(1, N / (2 * K)));
    const st = (16 + 30 * Math.min(2.5, w)) * sc,
      sn = st * (0.45 + r() * 0.5);
    clusters.push({ u: uc, off: coff, ph: r() * 6.283 });
    const ci = cidx++;
    // hub = best-connected node of the bin, at the bin centre
    let best = bin.members[0];
    for (const i of bin.members) if (deg[i] > deg[best]) best = i;
    const groups = [...bin.groups.values()].sort((p, q) => q.length - p.length);
    const subs = new Map();
    groups.forEach((g, gi) => {
      const gr = rng(hash32("g" + bin.id + ":" + keys[g[0]]));
      const dt = gi === 0 ? 0 : gauss(gr) * st * 1.1,
        dn = gi === 0 ? 0 : gauss(gr) * sn * 1.1;
      subs.set(keys[g[0]], {
        dt,
        dn,
        n: g.length,
        lead: g.reduce((a, b) => (deg[b] > deg[a] ? b : a), g[0]),
      });
    });
    for (const i of bin.members) {
      const nr = rng(hash32(nodes[i].id));
      const s = subs.get(keys[i]);
      let dt, dn;
      if (loose[i] && i !== best) {
        // on the filament at its own recency, tiny jitter, no cluster offset
        const uu = wrap(uc + (rank[i] * K - bin.b - 0.5) / K / 2);
        nu[i] = uu;
        noff[i] = gauss(nr) * 0.03;
        ndt[i] = gauss(nr) * 4;
        ndn[i] = gauss(nr) * 4;
        u[i] = wrap(uu + ndt[i] / CIRC);
        ph[i] = nr() * 6.283;
        cl[i] = ci;
        continue;
      }
      if (i === best) {
        dt = 0;
        dn = 0;
      } else if (s && i === s.lead && s.n >= 6 && s.dt !== 0) {
        dt = s.dt;
        dn = s.dn;
      } else {
        const rr = nr();
        const sub = s && s.n >= 6 && s.dt !== 0 && rr < 0.42;
        const spread = rr > 0.93 ? 1.9 : sub ? 0.3 : 1;
        dt = (sub ? s.dt : 0) + gauss(nr) * st * spread;
        dn = (sub ? s.dn : 0) + gauss(nr) * sn * spread;
      }
      nu[i] = uc;
      noff[i] = coff;
      ndt[i] = dt;
      ndn[i] = dn;
      u[i] = wrap(uc + dt / CIRC);
      ph[i] = nr() * 6.283;
      cl[i] = ci;
    }
    hub[best] = 2;
    hubs.push(best);
    for (const s of subs.values())
      if (s.lead !== best && s.n >= 6) {
        hub[s.lead] = 1;
        subhubs.push(s.lead);
      }
  }
  // rest positions (t = 0) for fit()
  for (let i = 0; i < N; i++) {
    const p = Math.PI + nu[i] * 6.2832,
      cs = Math.cos(p),
      sn2 = Math.sin(p),
      sc1 = 1 + noff[i];
    const x0 = A * sc1 * cs,
      y0 = B * sc1 * sn2;
    let tx = -A * sn2,
      ty = B * cs;
    const tl = Math.hypot(tx, ty);
    tx /= tl;
    ty /= tl;
    const px = x0 + tx * ndt[i] - ty * ndn[i],
      py = y0 + ty * ndt[i] + tx * ndn[i];
    ox[i] = px * CR - py * SR;
    oy[i] = px * SR + py * CR;
  }
  // links grouped by type; curved when they travel along the ring
  const byType = [[], [], [], []];
  raw.forEach((l, li) => byType[linkTypeCode(l.type)].push(li));
  const la = new Uint32Array(L),
    lb = new Uint32Array(L),
    lt = new Uint8Array(L),
    lk = new Uint8Array(L),
    lc = new Float32Array(L * 3),
    typeOff = new Uint32Array(5);
  let o = 0;
  for (let ty = 0; ty < 4; ty++) {
    typeOff[ty] = o;
    for (const li of byType[ty]) {
      const l = raw[li],
        a = index.get(l.source),
        b = index.get(l.target);
      la[o] = a;
      lb[o] = b;
      lt[o] = ty;
      let du = u[b] - u[a];
      if (du > 0.5) du -= 1;
      if (du < -0.5) du += 1;
      if (Math.abs(du) > 0.03) {
        const br = rng(hash32(l.source + "|" + l.target));
        lk[o] = 1;
        lc[o * 3] = u[a] + du / 3;
        lc[o * 3 + 1] = u[a] + (du * 2) / 3;
        lc[o * 3 + 2] = gauss(br) * 0.22;
      }
      o++;
    }
  }
  typeOff[4] = L;
  let Lc = 0;
  for (let i = 0; i < L; i++) Lc += lk[i];
  const adjOff = new Uint32Array(N + 1),
    adj = new Uint32Array(L * 2),
    fill = new Uint32Array(N);
  for (let i = 0; i < L; i++) {
    adjOff[la[i] + 1]++;
    adjOff[lb[i] + 1]++;
  }
  for (let i = 0; i < N; i++) adjOff[i + 1] += adjOff[i];
  for (let i = 0; i < L; i++) {
    adj[adjOff[la[i]] + fill[la[i]]++] = i;
    adj[adjOff[lb[i]] + fill[lb[i]]++] = i;
  }
  // sizes
  const rad = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dz = 0.78 + 0.34 * depth(u[i]);
    let base = hub[i] === 2 ? 4.6 : hub[i] === 1 ? 2.4 : 0.4 + Math.sqrt(deg[i] / maxd) * 0.9;
    if (opts.size && !hub[i]) base = Math.max(0.5, Math.min(5, opts.size(nodes[i]) * 0.3));
    rad[i] = base * dz;
  }
  // stardust + bokeh, tinted by horizon position
  const dr = rng(hash32("dust" + N));
  const DN = Math.round(700 + N * 0.06),
    dust = new Float32Array(DN * 4),
    dc = new Uint8Array(DN);
  for (let i = 0; i < DN; i++) {
    const dx = (dr() - 0.5) * A * 3.2,
      dy = (dr() - 0.5) * B * 5.2;
    dust[i * 4] = dx;
    dust[i * 4 + 1] = dy;
    dust[i * 4 + 2] = 0.15 + dr() * 0.4;
    dust[i * 4 + 3] = dr() < 0.08 ? 1.7 : 1;
    dc[i] = Math.round(Math.max(0, Math.min(1, (dx + A) / (2 * A) + gauss(dr) * 0.08)) * STEPS);
  }
  const bokeh = [];
  for (let i = 0; i < 40; i++)
    bokeh.push({
      x: (dr() - 0.5) * A * 3,
      y: (dr() - 0.5) * B * 4.6,
      rad: 5 + Math.pow(dr(), 2) * 26,
      a: 0.35 + dr() * 0.65,
      z: 0.3 + dr() * 0.5,
    });
  const texts = nodes.map((n) => n.label || n.id);
  return {
    N,
    L,
    Lc,
    nodes,
    texts,
    ox,
    oy,
    x: new Float32Array(N),
    y: new Float32Array(N),
    u,
    nu,
    noff,
    ndt,
    ndn,
    ph,
    cl,
    hub,
    rad,
    deg,
    heat,
    hasHeat,
    ecol,
    la,
    lb,
    lt,
    lk,
    lc,
    typeOff,
    adjOff,
    adj,
    clusters,
    hubs,
    subhubs,
    dust,
    dc,
    DN,
    bokeh,
    edgesCapped: (data.links || []).length > L,
    node(i) {
      return nodes[i];
    },
  };
}

/** Mount the renderer on a host element. */
export function mount(host, graph, opts = {}) {
  const cv = document.createElement("canvas");
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  host.appendChild(cv);
  const eL = document.createElement("canvas"),
    nL = document.createElement("canvas");
  const ctx = cv.getContext("2d"),
    ex = eL.getContext("2d"),
    nx = nL.getContext("2d"),
    dpr = Math.min(devicePixelRatio || 1, 2);
  let W = 0,
    H = 0;
  const hasFilter = "filter" in ctx;
  const S = {
    tx: 0,
    ty: 0,
    k: 1,
    hover: -1,
    sel: -1,
    hl: 0,
    paused: reduceMotion,
    t0: performance.now(),
    run: true,
    graph,
    fps: 0,
    ms: 0,
    drawn: 0,
    labels: 0,
    frames: 0,
    orbit: 0,
    beat: 0,
    act: 0,
    actTarget: 0,
    hb: 0,
    br: 1,
  };
  let sprites = {},
    P = palette(),
    colTab = [],
    cidx,
    keys,
    sorted,
    counts,
    litN,
    litL,
    cdx,
    cdy,
    lightSet = null,
    dirty = 2,
    lastView = "",
    last = 0;
  const big = [];
  function colorize() {
    const g = S.graph;
    colTab = [];
    for (let i = 0; i <= STEPS; i++) colTab.push(ramp(P.ramp, i / STEPS));
    const extra = new Map();
    cidx = new Uint16Array(g.N);
    for (let i = 0; i < g.N; i++) {
      if (g.hasHeat[i] || !g.ecol[i]) cidx[i] = Math.round(g.heat[i] * STEPS);
      else {
        if (!extra.has(g.ecol[i])) {
          extra.set(g.ecol[i], colTab.length);
          colTab.push(hex(g.ecol[i]));
        }
        cidx[i] = extra.get(g.ecol[i]);
      }
    }
    counts = new Int32Array(colTab.length * 2 + 3);
  }
  function alloc() {
    const g = S.graph;
    keys = new Uint16Array(g.N);
    sorted = new Uint32Array(g.N);
    litN = new Uint8Array(g.N);
    litL = new Uint8Array(g.L);
    cdx = new Float32Array(g.clusters.length);
    cdy = new Float32Array(g.clusters.length);
    colorize();
  }
  alloc();
  function size() {
    const r = host.getBoundingClientRect();
    W = r.width;
    H = r.height;
    cv.width = eL.width = nL.width = Math.max(1, W * dpr);
    cv.height = eL.height = nL.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!S.fitted) {
      fit();
      S.fitted = true;
    }
    dirty = 2;
  }
  function fit() {
    const g = S.graph;
    if (!g.N) return;
    let mnx = 1e9,
      mny = 1e9,
      mxx = -1e9,
      mxy = -1e9;
    for (let i = 0; i < g.N; i++) {
      mnx = Math.min(mnx, g.ox[i]);
      mxx = Math.max(mxx, g.ox[i]);
      mny = Math.min(mny, g.oy[i]);
      mxy = Math.max(mxy, g.oy[i]);
    }
    const k = Math.min((W - 100) / Math.max(1, mxx - mnx), (H - 70) / Math.max(1, mxy - mny));
    S.k = Math.min(2.2, Math.max(0.1, k));
    S.tx = W / 2 - ((mnx + mxx) / 2) * S.k;
    S.ty = H / 2 - ((mny + mxy) / 2) * S.k;
    dirty = 2;
  }
  const col = (ci) => colTab[ci] || colTab[0];
  function sprite(kind, c, rad) {
    const id = kind + "|" + c.join(",") + "|" + rad;
    if (sprites[id]) return sprites[id];
    const mult = kind === "hub" ? 9 : kind === "bokeh" ? 2.2 : 4,
      s = Math.ceil(rad * mult) + 4,
      cvs = document.createElement("canvas");
    cvs.width = cvs.height = s * dpr;
    const x = cvs.getContext("2d");
    x.scale(dpr, dpr);
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    if (kind === "hub") {
      g.addColorStop(0, rgba(P.hot, 0.95));
      g.addColorStop(0.08, rgba(c, 0.9));
      g.addColorStop(0.22, rgba(c, 0.35 * P.glow));
      g.addColorStop(0.5, rgba(c, 0.09 * P.glow));
      g.addColorStop(1, rgba(c, 0));
      x.fillStyle = g;
      x.fillRect(0, 0, s, s);
    } else if (kind === "bokeh") {
      g.addColorStop(0, rgba(c, 0.9));
      g.addColorStop(0.7, rgba(c, 0.55));
      g.addColorStop(1, rgba(c, 0));
      x.fillStyle = g;
      x.fillRect(0, 0, s, s);
    } else {
      g.addColorStop(0, rgba(c, 0.45 * P.glow));
      g.addColorStop(0.4, rgba(c, 0.08 * P.glow));
      g.addColorStop(1, rgba(c, 0));
      x.fillStyle = g;
      x.fillRect(0, 0, s, s);
      x.beginPath();
      x.arc(s / 2, s / 2, rad, 0, 6.283);
      x.fillStyle = rgba(c, 1);
      x.fill();
      x.beginPath();
      x.arc(s / 2 - rad * 0.25, s / 2 - rad * 0.25, rad * 0.42, 0, 6.283);
      x.fillStyle = "rgba(255,255,255,.3)";
      x.fill();
    }
    return (sprites[id] = { c: cvs, s });
  }
  function setLight(focus) {
    const g = S.graph;
    litN.fill(0);
    litL.fill(0);
    lightSet = { f: focus, links: [] };
    litN[focus] = 1;
    for (let k = g.adjOff[focus]; k < g.adjOff[focus + 1]; k++) {
      const li = g.adj[k];
      litL[li] = 1;
      litN[g.la[li]] = 1;
      litN[g.lb[li]] = 1;
      lightSet.links.push(li);
    }
    dirty = 2;
  }
  const cp1 = [0, 0],
    cp2 = [0, 0];
  function edgePath(x, g, li) {
    const a = g.la[li],
      b = g.lb[li];
    x.moveTo(g.x[a], g.y[a]);
    if (g.lk[li]) {
      ring(g.lc[li * 3] + S.orbit, g.lc[li * 3 + 2], cp1);
      ring(g.lc[li * 3 + 1] + S.orbit, g.lc[li * 3 + 2], cp2);
      x.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], g.x[b], g.y[b]);
    } else x.lineTo(g.x[b], g.y[b]);
  }
  function drawEdges(g, dim0) {
    ex.setTransform(dpr, 0, 0, dpr, 0, 0);
    ex.globalCompositeOperation = "source-over";
    ex.clearRect(0, 0, W, H);
    ex.translate(S.tx, S.ty);
    ex.scale(S.k, S.k);
    ex.lineCap = "round";
    const ds = 1 / S.k;
    counts.fill(0);
    for (let i = 0; i < g.DN; i++) counts[g.dc[i] + 1]++;
    for (let pass = 0; pass <= STEPS; pass++) {
      if (!counts[pass + 1]) continue;
      ex.fillStyle = rgba(col(pass), P.dust * dim0);
      ex.beginPath();
      for (let i = 0; i < g.DN; i++) {
        if (g.dc[i] !== pass) continue;
        const da = g.dust[i * 4 + 2],
          dsz = g.dust[i * 4 + 3] * ds;
        ex.rect(g.dust[i * 4], g.dust[i * 4 + 1], dsz * (da > 0.4 ? 1.4 : 1), dsz);
      }
      ex.fill();
    }
    const La =
      Math.min(1, Math.sqrt(5000 / Math.max(1, g.L))) *
      P.edgeA *
      (0.55 + 0.45 * Math.min(1, S.k / 1.4));
    for (let ty = 0; ty < 4; ty++) {
      const lc = hex(P.link[TYPES[ty]]);
      for (let curved = 0; curved < 2; curved++) {
        let any = false;
        ex.beginPath();
        for (let li = g.typeOff[ty]; li < g.typeOff[ty + 1]; li++) {
          if (g.lk[li] !== curved) continue;
          if (lightSet && litL[li]) continue;
          edgePath(ex, g, li);
          any = true;
        }
        if (!any) continue;
        const alpha =
          La *
          (ty === 3 ? 1.3 : ty === 2 ? 0.95 : 1) *
          (curved ? 0.5 * Math.min(1, Math.sqrt(1200 / Math.max(1, g.Lc))) : 1) *
          dim0 *
          (1 + 0.25 * S.act);
        ex.strokeStyle = rgba(lc, Math.min(1, alpha));
        ex.lineWidth = (ty === 3 ? 0.7 : 1) / S.k;
        ex.stroke();
      }
    }
    if (lightSet)
      for (let ty = 0; ty < 4; ty++) {
        ex.beginPath();
        let any = false;
        for (const li of lightSet.links) {
          if (g.lt[li] !== ty) continue;
          edgePath(ex, g, li);
          any = true;
        }
        if (!any) continue;
        ex.strokeStyle = rgba(hex(P.link[TYPES[ty]]), 0.9);
        ex.lineWidth = 1.6 / S.k;
        ex.stroke();
      }
  }
  function drawNodes(g, t, focus, dim0) {
    nx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nx.globalCompositeOperation = "source-over";
    nx.clearRect(0, 0, W, H);
    nx.globalCompositeOperation = P.blend;
    nx.translate(S.tx, S.ty);
    nx.scale(S.k, S.k);
    const N = g.N,
      P30 = (2 * Math.PI) / 30;
    counts.fill(0);
    for (let i = 0; i < N; i++) {
      const key = cidx[i] * 2 + (lightSet ? litN[i] : 1);
      keys[i] = key;
      counts[key + 1]++;
    }
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    const fillPos = counts.slice();
    for (let i = 0; i < N; i++) sorted[fillPos[keys[i]]++] = i;
    big.length = 0;
    let drawn = 0;
    for (let key = 0; key < colTab.length * 2; key++) {
      const from = counts[key],
        to = counts[key + 1];
      if (from === to) continue;
      const cc = col(key >> 1),
        lit = key & 1,
        a2 = Math.min(1, (lit ? 1 : dim0) * P.nodeA * S.br);
      nx.fillStyle = rgba(cc, a2);
      nx.beginPath();
      let anyR = false;
      for (let p = from; p < to; p++) {
        const i = sorted[p],
          rr = g.rad[i],
          sxp = g.x[i] * S.k + S.tx,
          syp = g.y[i] * S.k + S.ty;
        if (sxp < -20 || sxp > W + 20 || syp < -20 || syp > H + 20) continue;
        drawn++;
        if (rr * S.k < 2.2 && !g.hub[i]) {
          nx.rect(g.x[i] - rr, g.y[i] - rr, rr * 2, rr * 2);
          anyR = true;
        } else big.push(i);
      }
      if (anyR) nx.fill();
    }
    for (const i of big) {
      const c2 = col(keys[i] >> 1),
        lit2 = keys[i] & 1,
        dim = lit2 ? 1 : dim0;
      const pulse = g.hub[i] && !S.paused ? 1 + Math.sin(t * P30 * 2.2 + g.ph[i]) * 0.06 : 1;
      const rad = g.rad[i] * pulse * (i === focus ? 1.3 : 1),
        sp2 = sprite(g.hub[i] === 2 ? "hub" : "dot", c2, Math.max(1, Math.round(rad * 2) / 2));
      nx.globalAlpha = Math.min(1, dim * (0.85 + 0.15 * S.br));
      nx.drawImage(sp2.c, g.x[i] - sp2.s / 2, g.y[i] - sp2.s / 2, sp2.s, sp2.s);
      if (g.hub[i] === 2) {
        nx.strokeStyle = rgba(P.hot, 0.35 * dim);
        nx.lineWidth = 0.6 / S.k;
        const fl = rad * 5;
        nx.beginPath();
        nx.moveTo(g.x[i] - fl, g.y[i]);
        nx.lineTo(g.x[i] + fl, g.y[i]);
        nx.moveTo(g.x[i], g.y[i] - fl * 0.5);
        nx.lineTo(g.x[i], g.y[i] + fl * 0.5);
        nx.stroke();
      }
    }
    nx.globalAlpha = 1;
    S.drawn = drawn;
  }
  function frame(now) {
    if (!S.run) return;
    requestAnimationFrame(frame);
    const t0 = performance.now(),
      g = S.graph,
      N = g.N,
      t = (now - S.t0) / 1000;
    let dts = 0;
    if (last) {
      const dt = now - last;
      dts = Math.min(0.1, dt / 1000);
      S.fps += (1000 / Math.max(1, dt) - S.fps) * 0.08;
    }
    last = now;
    S.act += (S.actTarget - S.act) * Math.min(1, dts * 1.2);
    if (Math.abs(S.act - S.actTarget) < 0.003) S.act = S.actTarget;
    if (!S.paused && !reduceMotion) {
      S.beat += dts / (4.8 - 2 * S.act);
      const bp = S.beat % 1;
      S.hb =
        Math.exp((-(bp - 0.1) * (bp - 0.1)) / 0.005) +
        0.5 * Math.exp((-(bp - 0.3) * (bp - 0.3)) / 0.006);
    }
    S.br = 1 + S.hb * (0.07 + 0.16 * S.act) + 0.32 * S.act;
    const target = S.hover >= 0 || S.sel >= 0 ? 1 : 0,
      hl0 = S.hl;
    S.hl += (target - S.hl) * (reduceMotion ? 1 : 0.22);
    if (Math.abs(S.hl - target) < 0.002) S.hl = target;
    const focus = S.sel >= 0 ? S.sel : S.hover;
    if (focus >= 0 && (!lightSet || lightSet.f !== focus)) setLight(focus);
    if (focus < 0 && lightSet) {
      lightSet = null;
      dirty = 2;
    }
    const view = S.tx + "," + S.ty + "," + S.k;
    if (view !== lastView) {
      lastView = view;
      dirty = 2;
    }
    if (S.hl !== hl0) dirty = 2;
    const still = (S.paused || reduceMotion) && !dirty;
    S.frames++;
    if (!still && N) {
      const amp = S.paused ? 0 : 1,
        P30 = (2 * Math.PI) / 30,
        dim0 = 1 - S.hl * 0.78;
      for (let k = 0; k < g.clusters.length; k++) {
        const c = g.clusters[k];
        cdx[k] = Math.sin(t * P30 * 1.1 + c.ph) * amp * 2.2;
        cdy[k] = Math.cos(t * P30 * 0.9 + c.ph * 1.3) * amp * 1.2;
      }
      if (!S.paused) S.orbit += dts / 1080;
      for (let i = 0; i < N; i++) {
        const ci = g.cl[i],
          pu = Math.PI + (g.nu[i] + S.orbit) * 6.2832,
          cs = Math.cos(pu),
          sn2 = Math.sin(pu),
          sc1 = 1 + g.noff[i];
        const x0 = A * sc1 * cs,
          y0 = B * sc1 * sn2;
        let tx0 = -A * sn2,
          ty0 = B * cs;
        const tl = Math.sqrt(tx0 * tx0 + ty0 * ty0);
        tx0 /= tl;
        ty0 /= tl;
        const px = x0 + tx0 * g.ndt[i] - ty0 * g.ndn[i],
          py = y0 + ty0 * g.ndt[i] + tx0 * g.ndn[i];
        g.x[i] = px * CR - py * SR + cdx[ci] + Math.sin(t * P30 * 1.7 + g.ph[i]) * amp * 0.5;
        g.y[i] = px * SR + py * CR + cdy[ci] + Math.cos(t * P30 * 1.3 + g.ph[i]) * amp * 0.3;
      }
      if (dirty || (S.frames & 1) === 0) drawEdges(g, dim0);
      drawNodes(g, t, focus, dim0);
      if (dirty) dirty--;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = P.blend;
      for (const bk of g.bokeh) {
        const kz = S.k * bk.z,
          sx = W / 2 + bk.x * kz + (S.tx - W / 2) * bk.z,
          sy = H / 2 + bk.y * kz + (S.ty - H / 2) * bk.z,
          brad = bk.rad * Math.sqrt(S.k);
        if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
        const sp = sprite(
          "bokeh",
          col(Math.round(Math.max(0, Math.min(1, (bk.x + A) / (2 * A))) * STEPS)),
          Math.round(brad)
        );
        ctx.globalAlpha = P.bokeh * bk.a * dim0;
        ctx.drawImage(sp.c, sx - sp.s / 2, sy - sp.s / 2, sp.s, sp.s);
      }
      const cxs = S.tx,
        cys = S.ty,
        crad = R * 0.9 * S.k,
        ca = (P.blend === "lighter" ? 0.05 : 0.025) * (1 + 1.8 * S.act) * (0.9 + 0.1 * S.hb) * dim0;
      const cg = ctx.createRadialGradient(cxs, cys, 0, cxs, cys, crad),
        cc0 = col(Math.round(STEPS * (0.45 + 0.25 * S.act)));
      cg.addColorStop(0, rgba(cc0, ca));
      cg.addColorStop(0.45, rgba(cc0, ca * 0.35));
      cg.addColorStop(1, rgba(cc0, 0));
      ctx.fillStyle = cg;
      ctx.save();
      ctx.translate(cxs, cys);
      ctx.scale(1, B / A);
      ctx.translate(-cxs, -cys);
      ctx.beginPath();
      ctx.arc(cxs, cys, crad, 0, 6.283);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      if (hasFilter && P.bloom) {
        ctx.globalCompositeOperation = P.bloomBlend;
        ctx.filter = "blur(14px)";
        ctx.globalAlpha = Math.min(1, P.bloom * 0.5 * S.br);
        ctx.drawImage(eL, 0, 0, W, H);
        ctx.drawImage(nL, 0, 0, W, H);
        ctx.filter = "blur(4px)";
        ctx.globalAlpha = Math.min(1, P.bloom * S.br);
        ctx.drawImage(nL, 0, 0, W, H);
        ctx.filter = "none";
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(eL, 0, 0, W, H);
      ctx.globalCompositeOperation = P.blend;
      ctx.drawImage(nL, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      // labels: hubs at rest, the focused neighbourhood when hovering
      ctx.save();
      ctx.translate(S.tx, S.ty);
      ctx.scale(S.k, S.k);
      ctx.font = "500 " + 10.5 / S.k + 'px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = "middle";
      const occ = {},
        seen = {},
        maxL = lightSet ? 14 : S.k > 1.9 ? 18 : S.k > 1.3 ? 8 : 4;
      let shown = 0;
      let order = g.hubs.concat(g.subhubs);
      if (lightSet) {
        const nb = [];
        for (let k = g.adjOff[focus]; k < g.adjOff[focus + 1]; k++) {
          const li = g.adj[k];
          nb.push(g.la[li] === focus ? g.lb[li] : g.la[li]);
        }
        order = [focus].concat(nb);
      }
      for (let o = 0; o < order.length && shown < maxL; o++) {
        const i = order[o],
          txt0 = g.texts[i] || "";
        if (!txt0 || seen[txt0]) continue;
        const kx = Math.round((g.x[i] * S.k + S.tx) / 240),
          ky = Math.round((g.y[i] * S.k + S.ty) / 20),
          kk = kx + "," + ky;
        if (
          occ[kk] ||
          occ[kx + "," + (ky - 1)] ||
          occ[kx + "," + (ky + 1)] ||
          occ[kx + 1 + "," + ky] ||
          occ[kx - 1 + "," + ky]
        )
          continue;
        occ[kk] = 1;
        seen[txt0] = 1;
        shown++;
        const txt = txt0.slice(0, 34) + (txt0.length > 34 ? "…" : ""),
          tw = ctx.measureText(txt).width;
        const flip = (g.x[i] + g.rad[i] + 15 / S.k + tw) * S.k + S.tx > W - 8,
          lx0 = flip ? g.x[i] - g.rad[i] - 9 / S.k - tw : g.x[i] + g.rad[i] + 9 / S.k;
        ctx.fillStyle = rgba(hex(P.bg), 0.72);
        ctx.fillRect(lx0 - 3 / S.k, g.y[i] - 7 / S.k, tw + 6 / S.k, 14 / S.k);
        ctx.fillStyle = rgba(hex(P.ink), 0.88);
        ctx.fillText(txt, lx0, g.y[i]);
      }
      S.labels = shown;
      ctx.restore();
    }
    S.ms += (performance.now() - t0 - S.ms) * 0.1;
    if (opts.onFrame) opts.onFrame(S, g);
  }
  // interaction, bound 1:1
  let drag = null,
    moved = false;
  function pick(e) {
    const g = S.graph,
      r = cv.getBoundingClientRect(),
      x = (e.clientX - r.left - S.tx) / S.k,
      y = (e.clientY - r.top - S.ty) / S.k;
    let best = -1,
      bd = 64 / (S.k * S.k);
    for (let i = 0; i < g.N; i++) {
      const dx = g.x[i] - x,
        dy = g.y[i] - y,
        d = dx * dx + dy * dy;
      if (d < bd + g.rad[i] * g.rad[i]) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  const onDown = (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty };
    moved = false;
    cv.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (drag) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      S.tx = drag.tx + dx;
      S.ty = drag.ty + dy;
      return;
    }
    const h = pick(e);
    if (h !== S.hover) {
      S.hover = h;
      cv.style.cursor = h >= 0 ? "pointer" : "grab";
      if (opts.onHover) opts.onHover(h >= 0 ? S.graph.node(h) : null, e);
    } else if (h >= 0 && opts.onHover) opts.onHover(S.graph.node(h), e);
  };
  const onUp = (e) => {
    const was = drag;
    drag = null;
    if (!moved && was) {
      const h = pick(e);
      S.sel = h;
      if (h >= 0 && opts.onSelect) opts.onSelect(S.graph.node(h));
    }
  };
  const onLeave = () => {
    S.hover = -1;
    if (opts.onHover) opts.onHover(null);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(),
      px = e.clientX - r.left,
      py = e.clientY - r.top,
      nk = Math.min(8, Math.max(0.3, S.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    S.tx = px - ((px - S.tx) * nk) / S.k;
    S.ty = py - ((py - S.ty) * nk) / S.k;
    S.k = nk;
  };
  const onDbl = () => fit();
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointerleave", onLeave);
  cv.addEventListener("wheel", onWheel, { passive: false });
  cv.addEventListener("dblclick", onDbl);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => size()) : null;
  if (ro) ro.observe(host);
  const mo = new MutationObserver(() => {
    P = palette();
    sprites = {};
    colorize();
    dirty = 2;
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const io = new IntersectionObserver((es) => {
    es.forEach((en) => {
      if (en.isIntersecting && !S.run) {
        S.run = true;
        last = 0;
        requestAnimationFrame(frame);
      } else if (!en.isIntersecting) S.run = false;
    });
  });
  io.observe(host);
  const onVis = () => {
    if (document.hidden) S.run = false;
    else if (!S.run) {
      S.run = true;
      last = 0;
      requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", onVis);
  size();
  requestAnimationFrame(frame);
  return {
    state: S,
    setGraph(g) {
      S.graph = g;
      S.sel = -1;
      S.hover = -1;
      lightSet = null;
      alloc();
      S.fitted = false;
      size();
    },
    fit,
    pause(p) {
      S.paused = p;
      dirty = 2;
    },
    activity(level) {
      S.actTarget = Math.max(0, Math.min(1, +level || 0));
    },
    png() {
      return cv.toDataURL("image/png");
    },
    canvas: cv,
    destroy() {
      S.run = false;
      io.disconnect();
      mo.disconnect();
      if (ro) ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      cv.remove();
    },
  };
}
