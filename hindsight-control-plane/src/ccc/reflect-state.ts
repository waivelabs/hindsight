"use client";
import * as React from "react";
import "./reflect-durable";
const session = () => typeof window === "undefined" ? null : (window as any).CCCReflectSession;
export function useCCCState<T>(bank: string | null, key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const api = session();
  return api ? api.useBankState(React, bank, key) : React.useState<T>(initial);
}
export function useCCCNotice(bank: string | null): string {
  const api = session();
  if (!api) { React.useSyncExternalStore(() => () => {}, () => "", () => ""); return ""; }
  api.useStatus(React, bank);
  return api.notice(bank);
}
