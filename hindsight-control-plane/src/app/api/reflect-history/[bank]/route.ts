import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";

export const dynamic = "force-dynamic";
const BANKS = new Set(["ccc-work", "ccc-core"]);
const reply = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store" },
});

// Existing control-plane middleware authenticates /api/*; the backend independently
// authenticates the same official credential and exact bank before reading history.
export async function GET(request: Request, context: { params: Promise<{ bank: string }> }) {
  const { bank } = await context.params;
  if (!BANKS.has(bank)) return reply({ error: "Unknown history bank" }, 404);
  const query = new URL(request.url).searchParams;
  const keys = [...query.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !["limit", "offset", "entry_id"].includes(key))) {
    return reply({ error: "Invalid history query" }, 400);
  }
  const identity = query.get("entry_id");
  if (identity !== null) {
    if (keys.length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(identity)) return reply({ error: "Invalid saved answer" }, 400);
  } else {
    const limit = query.get("limit") ?? "50", offset = query.get("offset") ?? "0";
    if (!/^\d+$/.test(limit) || !/^\d+$/.test(offset) || Number(limit) < 1 || Number(limit) > 100 || !Number.isSafeInteger(Number(offset))) {
      return reply({ error: "Invalid history page" }, 400);
    }
    query.set("limit", limit); query.set("offset", offset);
  }
  try {
    const upstream = await fetch(dataplaneBankUrl(bank, "/reflect-history") + "?" + query.toString(), {
      headers: getDataplaneHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000),
    });
    if (!upstream.ok) return reply({ error: upstream.status === 401 ? "Sign in to view saved reflections" : "Saved reflections are unavailable" }, [401,403,404,429].includes(upstream.status) ? upstream.status : 503);
    const reader = upstream.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 8388608) { await reader.cancel(); return reply({ error: "Saved reflection exceeds the display limit" }, 502); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.bank_id !== bank) return reply({ error: "History scope mismatch" }, 502);
    if (identity) return data.entry ? reply({ bank_id: bank, entry: data.entry }) : reply({ error: "Saved reflection not found" }, 404);
    // Card loads never expose or download all saved answer bodies to the browser.
    return reply({ bank_id: bank, entries: data.entries, total: data.total, archive_total: data.archive_total, limit: data.limit, offset: data.offset });
  } catch { return reply({ error: "Saved reflections are unavailable. Try again." }, 503); }
}
