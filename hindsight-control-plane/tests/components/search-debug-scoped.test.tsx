// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ bank: "ccc-work", recall: vi.fn() }));
vi.mock("@/lib/bank-context", () => ({
  useBank: () => ({ currentBank: state.bank }),
}));
vi.mock("@/lib/api", () => ({ client: { recall: state.recall } }));
vi.mock("@/components/memory-detail-modal", () => ({ MemoryDetailModal: () => null }));
import { SearchDebugView } from "@/components/search-debug-view";
import messages from "@/messages/en.json";

function view() {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SearchDebugView />
    </NextIntlClientProvider>
  );
}

function deferredRecall() {
  let resolve!: (reply: object) => void;
  state.recall.mockReturnValue(new Promise<object>((settle) => { resolve = settle; }));
  return resolve;
}

function submit(project: string) {
  fireEvent.change(screen.getByLabelText("Project slug"), { target: { value: project } });
  fireEvent.change(screen.getByPlaceholderText(messages.searchDebug.queryPlaceholder), {
    target: { value: "Widget history" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Recall" }));
}

describe("scoped Recall view", () => {
  beforeEach(() => {
    state.bank = "ccc-work";
    state.recall.mockReset();
  });
  afterEach(cleanup);

  it("shows a denied search inline", async () => {
    state.recall.mockRejectedValue(Object.assign(new Error("Check the project slug."), { status: 403 }));
    render(view());
    submit("unknown");
    expect((await screen.findByRole("alert")).textContent).toContain("Check the project slug.");
    expect(screen.queryByText("Ready to Recall")).toBeNull();
  });

  it("discards an in-flight result after the project changes", async () => {
    const finish = deferredRecall();
    render(view());
    submit("widget");
    fireEvent.change(screen.getByLabelText("Project slug"), { target: { value: "other" } });
    await act(async () => { finish({ results: [{ id: "old", text: "Old search result" }] }); });

    expect(screen.queryByText("Old search result")).toBeNull();
    expect(screen.queryByText("Ready to Recall")).toBeTruthy();
  });

  it("discards an in-flight result after the bank changes", async () => {
    const finish = deferredRecall();
    const rendered = render(view());
    submit("widget");
    state.bank = "ccc-core";
    rendered.rerender(view());
    await act(async () => { finish({ results: [{ id: "old", text: "Old search result" }] }); });

    expect(screen.queryByText("Old search result")).toBeNull();
    expect(screen.queryByLabelText("Project slug")).toBeNull();
  });
});
