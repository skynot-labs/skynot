import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { CONTRACT, type Meta } from "@skynot/contract";
import { HttpGateway } from "../adapters/http-gateway";
import { OFFICE_PATIENCE_MS, addressProblem, forgetConnection, officeOrigin, pair, pairingFrom, rememberConnection, rememberedConnection, type Connection } from "./connection";

export type Office =
  | { stage: "starting"; address: string | null }
  | { stage: "asking"; address: string; secret: string; problem: string | null }
  | { stage: "mismatched"; address: string; studioContract: number; officeContract: number }
  | { stage: "connected"; gateway: HttpGateway; remote: string | null };

const SESSION_ENDED = "The office no longer accepts this session. Pair this studio with it again.";
const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : "The office could not be paired.");

function metaInTime(gateway: HttpGateway): Promise<Meta | null> {
  const silence = new Promise<null>((resolve) => setTimeout(() => resolve(null), OFFICE_PATIENCE_MS));
  return Promise.race([gateway.meta().catch(() => null), silence]);
}

export function useOffice() {
  const [office, setOffice] = useState<Office>({ stage: "starting", address: null });
  // Every attempt to enter an office supersedes the ones before it: an answer that comes late changes nothing.
  const attempt = useRef(0);

  const enter = useCallback(async (attempted: number, connection?: Connection) => {
    const current = () => attempted === attempt.current;
    const address = connection?.office ?? location.origin;
    const gateway = new HttpGateway(connection, () => {
      if (!current()) return;
      forgetConnection();
      setOffice({ stage: "asking", address, secret: "", problem: SESSION_ENDED });
    });
    // An office that does not answer right now is left to the console, which says so and offers to retry.
    const meta = await metaInTime(gateway);
    if (!current()) return;
    if (meta && meta.contract !== CONTRACT) return setOffice({ stage: "mismatched", address, studioContract: CONTRACT, officeContract: meta.contract });
    setOffice({ stage: "connected", gateway, remote: connection ? new URL(connection.office).host : null });
  }, []);

  const enterOwnOffice = useCallback(async () => {
    const attempted = ++attempt.current;
    const meta = await metaInTime(new HttpGateway());
    if (attempted !== attempt.current) return;
    if (!meta) return setOffice({ stage: "asking", address: "", secret: "", problem: null });
    if (meta.requiresSession) return setOffice({ stage: "asking", address: location.origin, secret: "", problem: null });
    await enter(attempted);
  }, [enter]);

  const pairAndEnter = useCallback(
    async (address: string, secret: string, formOnScreen: boolean) => {
      const attempted = ++attempt.current;
      const origin = officeOrigin(address);
      const problem = addressProblem(address, location.protocol);
      if (!origin || problem) return setOffice({ stage: "asking", address: origin ?? address, secret, problem });
      if (!formOnScreen) setOffice({ stage: "starting", address: origin });
      try {
        const connection = await pair(origin, secret, location.protocol);
        if (attempted !== attempt.current) return;
        rememberConnection(connection);
        await enter(attempted, connection);
      } catch (cause) {
        if (attempted === attempt.current) setOffice({ stage: "asking", address: origin, secret, problem: reasonOf(cause) });
      }
    },
    [enter],
  );

  const connect = useCallback((address: string, secret: string) => pairAndEnter(address, secret, true), [pairAndEnter]);

  const disconnect = useCallback(() => {
    forgetConnection();
    setOffice({ stage: "starting", address: null });
    void enterOwnOffice();
  }, [enterOwnOffice]);

  useEffect(() => {
    const pairFromLink = () => {
      const pairing = pairingFrom(location.hash);
      if (/[#&]secret=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      if (pairing) void pairAndEnter(pairing.office, pairing.secret, false);
      return pairing !== null;
    };
    const remembered = rememberedConnection();
    const paired = pairFromLink();
    if (!paired && remembered) {
      setOffice({ stage: "starting", address: remembered.office });
      void enter(++attempt.current, remembered);
    } else if (!paired) void enterOwnOffice();
    addEventListener("hashchange", pairFromLink);
    return () => removeEventListener("hashchange", pairFromLink);
  }, [pairAndEnter, enter, enterOwnOffice]);

  return { office, connect, disconnect };
}
