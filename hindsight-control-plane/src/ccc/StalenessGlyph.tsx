"use client";

import { Check, CircleAlert, Clock, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type StalenessTone = "retrying" | "paused" | "stale" | "inSync";

/**
 * ccc(staleness): the compact presentation of StalenessBadge (`variant="dot"`),
 * drawn as a glyph. Status = glyph + colour, never colour alone
 * (DESIGN-LANGUAGE sections 2 and 7; WAI-1066).
 *
 * Same four states and the same tooltip text as the badge and inline variants.
 * The colour classes resolve through the palette slots (warn / bad / good), so
 * they follow the theme like the rest of the badge. The span carries the
 * accessible name; the SVG is decorative.
 */
const GLYPH = {
  retrying: RefreshCw,
  paused: CircleAlert,
  stale: Clock,
  inSync: Check,
} as const;

const TONE = {
  retrying: "text-amber-600 dark:text-amber-400",
  paused: "text-red-600 dark:text-red-400",
  stale: "text-amber-600 dark:text-amber-400",
  inSync: "text-emerald-600 dark:text-emerald-400",
} as const;

export function StalenessGlyph({
  tone,
  title,
  className,
}: {
  tone: StalenessTone;
  title: string;
  className?: string;
}) {
  const Glyph = GLYPH[tone];
  return (
    <span
      className={cn("inline-flex flex-shrink-0 items-center", TONE[tone], className)}
      role="img"
      aria-label={title}
      title={title}
    >
      <Glyph className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}
