import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { recallMemories } = vi.hoisted(() => ({ recallMemories: vi.fn() }));
vi.mock("@/lib/hindsight-client", () => ({
  dataplaneBankUrl: (bankId: string, suffix: string) =>
    `http://localhost:8888/v1/default/banks/${bankId}${suffix}`,
  getDataplaneHeaders: (headers: Record<string, string>) => headers,
  lowLevelClient: {},
  sdk: { recallMemories },
}));
import { POST } from "@/app/api/recall/route";

function request(body: object) {
  return new NextRequest("http://localhost/api/recall", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("dashboard Recall proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    recallMemories.mockReset();
  });

  it("sends scoped project and query to the guarded route", async () => {
    const fact = { id: "fact", lifecycle: "provisional", text: "Widget history" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      results: [fact],
    }));
    const response = await POST(request({
      bank_id: "ccc-work", project: "widget", query: "Widget history",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [fact] });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8888/v1/default/banks/ccc-work/scoped-recall",
      expect.objectContaining({ body: JSON.stringify({ project: "widget", query: "Widget history" }) })
    );
    expect(recallMemories).not.toHaveBeenCalled();
  });

  it("preserves denial status without exposing upstream diagnostics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ detail: "private diagnostic" }, { status: 403 })
    );
    const response = await POST(request({
      bank_id: "ccc-work", project: "unknown", query: "Widget",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("project slug"),
    });
  });

  it("preserves denials from the raw Recall endpoint", async () => {
    recallMemories.mockResolvedValue({
      response: new Response(null, { status: 403 }),
      error: { detail: "private diagnostic" },
    });
    const response = await POST(request({ bank_id: "ccc-work", query: "Widget" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("project slug") });
  });

  it.each([404, 409])("preserves upstream status %i with generic guidance", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ detail: "private diagnostic" }, { status })
    );
    const response = await POST(request({
      bank_id: "ccc-work", project: "widget", query: "Widget",
    }));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Recall is unavailable. Try again shortly." });
  });
});
