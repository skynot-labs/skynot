import type { readState } from "../../src/app/http/state";

export type ShopState = ReturnType<typeof readState> & { simulated: boolean };
export type OrderView = ShopState["orders"][number];
export type ChatView = ShopState["chat"][number];
export type DecisionView = ShopState["decisions"][number];
export type MinutesBucket = "lt5" | "5-15" | "15-30" | "gt30";

export async function fetchState(): Promise<ShopState> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error(`state failed (${response.status})`);
  return (await response.json()) as ShopState;
}

export async function command(path: string, body: object): Promise<string | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const detail = (await response.json().catch(() => null)) as { error?: string } | null;
  return detail?.error ?? `request failed (${response.status})`;
}

export function watch(onChange: () => void, onConnection: (connected: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const source = new EventSource("/api/events");

  source.onopen = () => {
    onConnection(true);
    onChange();
  };
  source.onerror = () => onConnection(false);
  source.onmessage = schedule;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(onChange, 60);
  }

  return () => {
    clearTimeout(timer);
    source.close();
  };
}
