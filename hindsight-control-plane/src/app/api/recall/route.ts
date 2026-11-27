import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders, lowLevelClient, sdk } from "@/lib/hindsight-client";

function recallError(request: NextRequest, status: number, error: string, key: string) {
  return NextResponse.json(
    localizeApiErrorPayload(request, { error, errorKey: `api.errors.recall.${key}` }),
    { status }
  );
}

function upstreamRecallError(request: NextRequest, bankId: string, status: number) {
  if (status === 403) {
    const scoped = bankId === "ccc-work";
    return recallError(
      request,
      status,
      scoped
        ? "Recall was denied for this scope. Check the project slug or ask the dashboard operator for help."
        : "Recall was denied. Check your access to the bank and the selected filters.",
      scoped ? "projectDenied" : "denied"
    );
  }
  if (status === 400 || status === 422) {
    return recallError(
      request, status, "Check your Recall query and filters, then try again.", "invalid"
    );
  }
  if (status === 429) {
    return recallError(request, status, "Recall is busy. Wait briefly and try again.", "rateLimited");
  }
  return recallError(
    request,
    status >= 400 ? status : 502,
    "Recall is unavailable. Try again shortly.",
    "unavailable"
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return upstreamRecallError(request, "default", 400);
  }
  try {
    const bankId = body.bank_id || body.agent_id || "default";
    const {
      query,
      types,
      fact_type,
      prefer_observations,
      max_tokens,
      trace,
      budget,
      include,
      query_timestamp,
      tags,
      tags_match,
      tag_groups,
      min_scores,
      temporal_window,
    } = body;

    if ((bankId === "ccc-core" || bankId === "ccc-work") && body.project !== undefined) {
      const response = await fetch(dataplaneBankUrl(bankId, "/scoped-recall"), {
        method: "POST",
        headers: getDataplaneHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ project: body.project, query, max_tokens }),
        signal: AbortSignal.timeout(95_000),
      });
      if (!response.ok) return upstreamRecallError(request, bankId, response.status);
      const data = await response.json();
      if (!Array.isArray(data?.results)) return upstreamRecallError(request, bankId, 502);
      return NextResponse.json({ results: data.results });
    }

    const response = await sdk.recallMemories({
      client: lowLevelClient,
      path: { bank_id: bankId },
      body: {
        query,
        types: types || fact_type,
        prefer_observations,
        max_tokens,
        trace,
        budget: budget || "mid",
        include,
        query_timestamp,
        tags,
        tags_match,
        tag_groups,
        min_scores,
        temporal_window,
      },
    });

    if (!response.data) {
      return upstreamRecallError(request, bankId, response.response?.status ?? 502);
    }

    // Return a clean JSON object by spreading the response
    // This ensures any non-serializable properties are excluded
    const jsonResponse = {
      results: response.data.results,
      trace: response.data.trace,
      entities: response.data.entities,
      chunks: response.data.chunks,
    };

    return NextResponse.json(jsonResponse, { status: 200 });
  } catch {
    return recallError(request, 502, "Recall is unavailable. Try again shortly.", "unavailable");
  }
}
