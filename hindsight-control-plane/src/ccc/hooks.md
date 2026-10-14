# CCC Layer B hooks (WAI-997)

Every selector `src/ccc/primitives.css` relies on, with the upstream line that
emits it. Re-check this table on each upstream rebase (`ccc/0.10.x`): if a
class string or Radix attribute moved, the rule silently stops matching.

| Primitive | Hook (selector) | Upstream source (v0.10.2) | Kind |
|-----------|-----------------|---------------------------|------|
| Card | `div.bg-card.border.rounded-\[16px\]` | `ui/card.tsx` Card base class | literal class |
| CardTitle | `div.text-2xl.font-semibold.tracking-tight` | `ui/card.tsx` CardTitle | literal class |
| Button (all) | `.inline-flex.rounded-\[10px\].text-\[13px\]` | `ui/button.tsx` cva base | literal class |
| Button default | `.inline-flex.rounded-\[10px\].bg-primary.text-primary-foreground` | cva `default` | literal class |
| Button gradient | `.inline-flex.rounded-\[10px\].bg-primary-gradient` | cva `gradient` | literal class |
| Button outline | `.inline-flex.rounded-\[10px\].border-border.bg-card` | cva `outline` | literal class |
| Button destructive | `.inline-flex.rounded-\[10px\].bg-destructive` | cva `destructive` | literal class |
| Input / Textarea | `input.rounded-\[10px\].border-border`, `textarea.rounded-\[10px\].border-border` | `ui/input.tsx`, `ui/textarea.tsx` | literal class |
| Select trigger | `button[role="combobox"].rounded-\[10px\]` | `ui/select.tsx` SelectTrigger (Radix role) | role + class |
| Table wrapper | `div.overflow-auto.ring-1.bg-card` | `ui/table.tsx` Table wrapper div | literal class |
| Table parts | `> table`, `> table > thead`, `th`, `td`, `> tbody > tr`, `tr[data-state="selected"]` | `ui/table.tsx` | element + data-state |
| Tabs list | `[role="tablist"].inline-flex.rounded-md.bg-muted` | `ui/tabs.tsx` TabsList (Radix role) | role + class |
| Tabs trigger | `[role="tablist"] > [role="tab"].rounded-sm[data-state="active"]` | `ui/tabs.tsx` TabsTrigger | role + data-state |
| Sidebar root | `aside.bg-card.border-r.h-full` | `components/sidebar.tsx` root | literal class |
| Sidebar active item | `aside… nav a.bg-primary-gradient` | `components/sidebar.tsx` isActive branch | literal class |
| Sidebar idle item | `aside… nav a.text-muted-foreground` | `components/sidebar.tsx` inactive branch | literal class |
| Checkbox | `button[role="checkbox"].rounded-sm[data-state="checked|indeterminate"]` | `ui/checkbox.tsx` (Radix) | role + data-state |
| Switch | `[data-slot="hs-switch"][data-state=…]` (in theme.css) | `ui/switch.tsx` | data-slot |
| Dialog overlay | `.fixed.inset-0.bg-black\/60` | `ui/dialog.tsx` DialogOverlay | literal class |
| Dialog content | `[role="dialog"].fixed.max-w-lg`, `[role="alertdialog"].fixed` | `ui/dialog.tsx`, `ui/alert-dialog.tsx` (Radix role) | role + class |
| Popover / Menu / Select content | `[data-radix-popper-content-wrapper] > [role="dialog"|"menu"|"listbox"]`, `[role="menu"].rounded-\[10px\]`, `[role="listbox"].rounded-\[10px\]` | Radix popper wrapper + roles | data attr + role |
| Menu items | `[role="menuitem"|"menuitemcheckbox"|"menuitemradio"|"option"][data-highlighted]` | Radix | role + data attr |
| Toast | `[data-sonner-toaster] [data-sonner-toast][data-type=…]`, `[data-icon]`, `[data-description]`, `[data-button]` | sonner DOM; upstream tone classes in `ui/sonner.tsx` use `!important`, so these rules live in `@layer theme` | data attr |
| Header bar | `div.bg-card.border-b-4.border-primary-gradient` | `components/bank-selector.tsx` header root | literal class |
| Home A2 (WAI-1005) | anchored block: 5 × `ccc(home)` markers + `@/ccc/HomeStats` import in `components/home-view.tsx`; strip/legend styles are own classes in `src/ccc/home.css` | `components/home-view.tsx` | anchored edit |
| Constellation (WAI-1055) | anchored: `export function Constellation(` → `function ConstellationLegacy(` + 3 × `ccc(constellation)` markers + `@/ccc/HorizonConstellation` import in `components/constellation.tsx`; 1 × `ccc(constellation)` (`cccLimit` prop) in `components/data-view.tsx`; renderer and chrome are own files `src/ccc/horizon-engine.js`, `HorizonConstellation.tsx`, `constellation.css`; uses upstream i18n keys `constellation.*` only | `components/constellation.tsx`, `components/data-view.tsx` | anchored edit |

## Specificity notes

- Tailwind utilities are `(0,1,0)` inside `@layer utilities`. Unlayered rules
  at `(0,2,0)+` win without `!important`.
- `!important` reverses layer order: an important declaration in an earlier
  layer beats a later or unlayered one. Upstream sonner tone classes are
  `!bg-*` utilities, so the toast overrides are declared inside `@layer theme`
  (the first layer Tailwind declares) and also marked important.
- Tailwind re-declares its palette variables inside an unlayered
  `@supports (color: lab())` block; token overrides for `--color-*` use
  `html:root` / `html.dark` (see theme.css).

## Not hooked (no stable hook, left as upstream)

- `facet-chip.tsx` chips: resolve through `--chip-*` tokens only.
- `staleness-badge.tsx`, `freshness-line.tsx`: resolve through the palette
  slots (`text-amber-*`, `bg-emerald-*` → warn/good) only.
- Dialog title / description: Inter, upstream sizes.
- Pagination, command palette: upstream.
