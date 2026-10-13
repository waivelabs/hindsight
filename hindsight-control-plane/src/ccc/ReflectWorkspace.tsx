"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useBank } from "@/lib/bank-context";
import { ThinkView } from "@/components/think-view";
import { ReflectHistory } from "./ReflectHistory";
import "./reflect-state";

export function ReflectWorkspace() {
  const { currentBank } = useBank();
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const history = params.get("panel") === "history";
  function select(value: boolean) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("panel", "history"); else next.delete("panel");
    router.replace(pathname + "?" + next.toString(), { scroll: false });
  }
  return <div>
    <nav aria-label="Reflection views" className="mb-5 flex gap-2 border-b border-border pb-3">
      <button type="button" aria-current={!history ? "page" : undefined} onClick={() => select(false)}
        className={`rounded-lg px-4 py-2 text-sm font-medium ${!history ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>Ask a question</button>
      <button type="button" aria-current={history ? "page" : undefined} onClick={() => select(true)}
        className={`rounded-lg px-4 py-2 text-sm font-medium ${history ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>Saved reflections</button>
    </nav>
    {history ? (currentBank ? <ReflectHistory bank={currentBank} /> : <p>Select a memory bank to see its saved reflections.</p>) : <ThinkView />}
  </div>;
}
