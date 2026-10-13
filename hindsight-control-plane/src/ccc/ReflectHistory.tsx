"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./reflect-history.css";

export type HistoryCard = {
  id: string; created_at: string; title: string; question: string;
  tags: string[]; status: "unverified"; duplicate_count?: number;
};
export type HistoryPage = { entries: HistoryCard[]; total: number; archive_total?: number; limit: number; offset: number };
export type HistoryEntry = {
  id: string; created_at: string;
  state: { fields: { query?: string; tags?: string; result: { text: string; based_on?: Record<string, unknown>; [key: string]: unknown } } };
};
export type HistoryAPI = {
  list: (bank: string, options: { limit: number; offset: number; query: string; signal: AbortSignal }) => Promise<HistoryPage>;
  detail: (bank: string, id: string, signal: AbortSignal) => Promise<HistoryEntry | null>;
};

async function historyGET(bank: string, params: URLSearchParams, signal: AbortSignal) {
  const response = await fetch(`/api/reflect-history/${encodeURIComponent(bank)}?${params}`, {
    credentials: "same-origin", cache: "no-store", signal,
  });
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Saved history unavailable");
  }
  return response.json();
}
export const reflectHistoryAPI: HistoryAPI = {
  list: (bank, { limit, offset, signal }) => historyGET(bank, new URLSearchParams({ limit: String(limit), offset: String(offset) }), signal),
  detail: async (bank, id, signal) => (await historyGET(bank, new URLSearchParams({ entry_id: id }), signal)).entry,
};

// Markdown HTML stays disabled. Restrict links to explicit web links and local anchors.
export function safeHistoryURL(url: string): string {
  if (/^(https?:\/\/|#)/i.test(url)) return url;
  return "";
}
function loggedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Logged time unknown" : date.toLocaleString();
}

function SourceProvenance({ basedOn }: { basedOn?: Record<string, unknown> }) {
  if (!basedOn || Object.keys(basedOn).length === 0) return <p>No source provenance was saved with this answer.</p>;
  return <>{Object.entries(basedOn).map(([group, value]) => {
    const sources = Array.isArray(value) ? value : [value];
    return <section className="rh-source-group" key={group}>
      <h3>{group.replace(/_/g, " ")} · {sources.length}</h3>
      {sources.length === 0 && <p>No sources saved in this group.</p>}
      {sources.map((source, index) => {
        const record = source && typeof source === "object" && !Array.isArray(source) ? source as Record<string, unknown> : {};
        const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata) ? record.metadata as Record<string, unknown> : {};
        const textValue = (item: unknown) => typeof item === "string" && item.trim() ? item : undefined;
        const title = textValue(record.title) || textValue(record.name) || textValue(record.document_id) || textValue(record.id) || `Source ${index + 1}`;
        const reference = textValue(record.source_ref) || textValue(metadata.source_ref);
        const lifecycle = record.ccc_lifecycle ?? record.lifecycle ?? metadata.ccc_lifecycle ?? metadata.lifecycle;
        const unverified = record.ccc_unverified ?? metadata.ccc_unverified;
        const sourceText = textValue(record.text) || textValue(record.content) || textValue(record.citation);
        return <details className="rh-source" key={index}>
          <summary><span>{index + 1}. {title}</span><span className="rh-source-labels">
            <span className="rh-badge">Saved evidence · not verified here</span>
            {lifecycle !== undefined && <span className="rh-source-label">Saved lifecycle: {String(lifecycle)}</span>}
            {unverified !== undefined && <span className="rh-source-label">Saved unverified flag: {String(unverified)}</span>}
          </span></summary>
          {record.id !== undefined && <p className="rh-source-ref">Citation ID: {String(record.id)}</p>}
          {reference && <p className="rh-source-ref">Source reference: {reference}</p>}
          {sourceText ? <p className="rh-source-text">{sourceText}</p> : <p>No source text was saved.</p>}
          <details><summary>Full saved source metadata</summary><pre>{JSON.stringify(source, null, 2)}</pre></details>
        </details>;
      })}
    </section>;
  })}</>;
}

export function ReflectHistory({ bank, api = reflectHistoryAPI }: { bank: string; api?: HistoryAPI }) {
  return <BankHistory key={bank} bank={bank} api={api} />;
}

function BankHistory({ bank, api }: { bank: string; api: HistoryAPI }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<HistoryCard | null>(null);
  const [dense, setDense] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPage(null);
    api.list(bank, { limit: 100, offset, query: "", signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setPage(value); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load saved reflections."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, bank, offset, retry]);
  const visible = page?.entries.filter(card => `${card.title} ${card.question} ${card.tags.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || [];
  const close = () => { setSelected(null); requestAnimationFrame(() => opener.current?.focus()); };
  return <section className="reflect-history" aria-label="Saved reflections">
    <div className="rh-toolbar">
      <div><h2>Reflection history</h2><p>Saved answers are unverified model output.</p></div>
      <form onSubmit={event => event.preventDefault()} role="search">
        <label htmlFor="rh-search">Filter this page of saved reflections</label>
        <div><input id="rh-search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Filter titles, questions or tags" /></div>
      </form>
      <label className="rh-density"><input type="checkbox" checked={dense} onChange={event => setDense(event.target.checked)} />Compact</label>
    </div>
    <div className="rh-scroll" aria-busy={loading}>
      {loading && <p role="status">Loading saved reflections…</p>}
      {error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {!loading && !error && visible.length === 0 && <p>{query ? "No reflections on this page match this filter." : "No saved reflections yet."}</p>}
      {!loading && !error && <div className={`rh-grid${dense ? " rh-compact" : ""}`}>
        {visible.map(card => <button className="rh-card" key={card.id} onClick={event => { opener.current = event.currentTarget; setSelected(card); }} aria-label={`Read saved reflection: ${card.title || card.question || "Untitled reflection"}`}>
          <span className="rh-badge">Unverified</span>
          <span className="rh-card-title">{card.title || card.question || "Untitled reflection"}</span>
          <time dateTime={card.created_at}>{loggedAt(card.created_at)}</time>
          <span className="rh-tags">{card.tags.map(tag => <span key={tag}>{tag}</span>)}</span>
          {(card.duplicate_count || 1) > 1 && <span className="rh-copies">{card.duplicate_count} saved copies</span>}
        </button>)}
      </div>}
    </div>
    <nav className="rh-pagination" aria-label="Reflection history pages">
      <button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button>
      <span role="status">{page ? `${page.total ? offset + 1 : 0}–${Math.min(offset + page.entries.length, page.total)} of ${page.total}` : ""}</span>
      <button disabled={loading || !page || offset + page.entries.length >= page.total} onClick={() => setOffset(offset + 100)}>Next</button>
    </nav>
    {selected && <HistoryReader key={`${bank}:${selected.id}`} bank={bank} card={selected} api={api} onClose={close} />}
  </section>;
}

function HistoryReader({ bank, card, api, onClose }: { bank: string; card: HistoryCard; api: HistoryAPI; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => { modal?.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setEntry(null);
    api.detail(bank, card.id, controller.signal).then(value => {
      if (!controller.signal.aborted) { setEntry(value); if (!value) setError("This saved reflection is unavailable."); }
    }).catch(() => { if (!controller.signal.aborted) setError("Could not open this saved reflection."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, bank, card.id, retry]);
  return <dialog ref={dialog} className="rh-reader" aria-labelledby="rh-reader-title" onCancel={event => { event.preventDefault(); onClose(); }} onPointerDown={event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    backdropDown.current = event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }} onClick={event => {
    if (backdropDown.current && event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }
  }}>
    <header><div><span className="rh-badge">Unverified model output</span><h2 id="rh-reader-title">Saved reflection</h2><time dateTime={card.created_at}>{loggedAt(card.created_at)}</time></div><button autoFocus onClick={onClose} aria-label="Close saved reflection">✕</button></header>
    <div className="rh-reader-content" aria-busy={loading}>
      {loading && <p role="status">Loading saved answer…</p>}
      {error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {entry && <>
        <div className="rh-tags">{card.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        {entry.state.fields.query && <details><summary>Saved question</summary><p className="rh-question">{entry.state.fields.query}</p></details>}
        <article aria-label="Full saved answer"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeHistoryURL} components={{ a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>, img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : "[Image omitted]"}</span> }}>{entry.state.fields.result.text}</ReactMarkdown></article>
        <details className="rh-provenance"><summary>Citations and source provenance</summary><p>Source records are saved evidence. They do not verify this answer. Labels below reproduce saved values.</p><SourceProvenance basedOn={entry.state.fields.result.based_on} /></details>
      </>}
    </div>
  </dialog>;
}
