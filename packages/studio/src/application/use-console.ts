import { useEffect, useState } from "preact/hooks";
import type { HttpGateway } from "../adapters/http-gateway";
import type { Snapshot } from "../contracts";

export function useConsole(gateway: HttpGateway, projectId?: string) {
  const [read, setRead] = useState<{ projectId: string | undefined; snapshot: Snapshot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let request = 0;
    let unwatch: (() => void) | undefined;
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
          setConnected(false);
        }
      }
    };
    void refresh().then(() => {
      if (active)
        unwatch = gateway.watch(
          () => void refresh(),
          (value) => {
            if (active) setConnected(value);
          },
        );
    });
    return () => {
      active = false;
      unwatch?.();
    };
  }, [gateway, projectId, revision]);
  // A click on the project just left would act on it, so its state is not shown while the next one loads.
  const snapshot = read && read.projectId === projectId ? read.snapshot : null;
  return { snapshot, error, connected, reload: () => setRevision((value) => value + 1) };
}
