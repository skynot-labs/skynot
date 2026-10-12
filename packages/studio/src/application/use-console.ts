import { useEffect, useState } from "preact/hooks";
import type { HttpGateway } from "../adapters/http-gateway";
import type { Snapshot } from "../contracts";
import { OFFICE_PATIENCE_MS } from "./connection";

type StreamState = "connecting" | "live" | "reconnecting";

export function useConsole(gateway: HttpGateway, projectId?: string) {
  const [read, setRead] = useState<{ projectId: string | undefined; snapshot: Snapshot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>("connecting");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const dropped = () => setStream((was) => (was === "connecting" ? was : "reconnecting"));
    let active = true;
    let request = 0;
    let unwatch: (() => void) | undefined;
    let patience: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const current = ++request;
      try {
        const value = await gateway.read(projectId);
        if (active && current === request) {
          setRead({ projectId, snapshot: value });
          setError(null);
        }
      } catch (cause) {
        if (active && current === request) {
          setError(cause instanceof Error ? cause.message : "Could not read the shop's state.");
          dropped();
        }
      }
    };
    void refresh().then(() => {
      if (!active) return;
      // A stream that never answers, not even to refuse, gets the time an office gets to answer at all.
      patience = setTimeout(() => setStream((was) => (was === "connecting" ? "reconnecting" : was)), OFFICE_PATIENCE_MS);
      unwatch = gateway.watch(
        () => void refresh(),
        (connected) => {
          if (!active) return;
          if (connected) setStream("live");
          else setStream("reconnecting");
        },
      );
    });
    return () => {
      active = false;
      clearTimeout(patience);
      unwatch?.();
    };
  }, [gateway, projectId, revision]);
  // A click on the project just left would act on it, so its state is not shown while the next one loads.
  const snapshot = read && read.projectId === projectId ? read.snapshot : null;
  return { snapshot, error, stream, reload: () => setRevision((value) => value + 1) };
}
