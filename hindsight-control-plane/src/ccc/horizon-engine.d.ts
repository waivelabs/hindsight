// ccc(constellation): types for the horizon-ring engine (horizon-engine.js).
import type { GraphData, GraphNode } from "@/components/graph-data";

export interface HorizonGraph {
  N: number;
  L: number;
  Lc: number;
  nodes: GraphNode[];
  edgesCapped: boolean;
  node(i: number): GraphNode;
}
export interface HorizonState {
  k: number;
  fps: number;
  ms: number;
  drawn: number;
  labels: number;
  paused: boolean;
  act: number;
}
export interface HorizonHandle {
  state: HorizonState;
  setGraph(g: HorizonGraph): void;
  fit(): void;
  pause(p: boolean): void;
  activity(level: number): void;
  png(): string;
  canvas: HTMLCanvasElement;
  destroy(): void;
}
export interface BuildOptions {
  heat?: (n: GraphNode) => number | null | undefined;
  key?: (n: GraphNode) => string | null | undefined;
  color?: (n: GraphNode) => string | null | undefined;
  size?: (n: GraphNode) => number;
  maxEdges?: number;
}
export function buildFromGraph(data: GraphData, opts?: BuildOptions): HorizonGraph;
export function mount(
  host: HTMLElement,
  graph: HorizonGraph,
  opts?: {
    onHover?: (node: GraphNode | null, e?: PointerEvent) => void;
    onSelect?: (node: GraphNode) => void;
    onFrame?: (s: HorizonState, g: HorizonGraph) => void;
  }
): HorizonHandle;
export function palette(): {
  ramp: string[];
  link: Record<string, string>;
  ink: string;
  bg: string;
};
export function linkColor(t: string): string;
export function rampCSS(): string;
