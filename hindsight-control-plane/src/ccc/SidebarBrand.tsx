"use client";

// ccc(brand): the Cortana lockup in the sidebar foot (WAI-1064, QA WAI-1001 F25).
// Open sidebar: horizontal lockup (mark + wordmark, 30 px) and the API version.
// Rail: the mark alone (24 px) over the version. Replaces "Hindsight v<version>".
// Styles: src/ccc/theme.css (.ccc-side-brand). Mounted by one anchored line in
// components/sidebar.tsx.

import { withBasePath } from "@/lib/base-path";

export function SidebarBrand({
  collapsed,
  version,
}: {
  collapsed: boolean;
  version: string | null;
}) {
  return (
    <div
      className={collapsed ? "ccc-side-brand ccc-side-brand--rail" : "ccc-side-brand"}
      title={version ? `API v${version}` : undefined}
    >
      <span className="ccc-side-brand__lockup">
        <img
          src={withBasePath("/ccc/cortana-mark.png")}
          alt="Cortana"
          className="ccc-side-brand__mark"
        />
        {!collapsed && <span className="ccc-wordmark ccc-wordmark--side" aria-hidden="true" />}
      </span>
      {version && <span className="ccc-side-brand__ver">v{version}</span>}
    </div>
  );
}
