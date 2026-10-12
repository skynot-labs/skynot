import { useCallback, useEffect, useState } from "preact/hooks";
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

  const enter = useCallback(async (connection?: Connection) => {
    const address = connection?.office ?? location.origin;
    const gateway = new HttpGateway(connection, () => {
      forgetConnection();
      setOffice({ stage: "asking", address, secret: "", problem: SESSION_ENDED });
    });
    // An office that does not answer right now is left to the console, which says so and offers to retry.
    const meta = await metaInTime(gateway);
    if (meta && meta.contract !== CONTRACT) return setOffice({ stage: "mismatched", address, studioContract: CONTRACT, officeContract: meta.contract });
    setOffice({ stage: "connected", gateway, remote: connection ? new URL(connection.office).host : null });
  }, []);

  const enterOwnOffice = useCallback(async () => {
    const meta = await metaInTime(new HttpGateway());
    if (!meta) return setOffice({ stage: "asking", address: "", secret: "", problem: null });
    if (meta.requiresSession) return setOffice({ stage: "asking", address: location.origin, secret: "", problem: null });
    await enter();
  }, [enter]);

  const connect = useCallback(
    async (address: string, secret: string) => {
      const origin = officeOrigin(address);
      const problem = addressProblem(address, location.protocol);
      if (!origin || problem) return setOffice({ stage: "asking", address: origin ?? address, secret, problem });
      setOffice({ stage: "starting", address: origin });
      try {
        const connection = await pair(origin, secret);
        rememberConnection(connection);
        await enter(connection);
      } catch (cause) {
        setOffice({ stage: "asking", address: origin, secret, problem: reasonOf(cause) });
      }
    },
    [enter],
  );

  const disconnect = useCallback(() => {
    forgetConnection();
    setOffice({ stage: "starting", address: null });
    void enterOwnOffice();
  }, [enterOwnOffice]);

  useEffect(() => {
    const pairFromLink = () => {
      const pairing = pairingFrom(location.hash);
      if (/[#&]secret=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      if (pairing) void connect(pairing.office, pairing.secret);
      return pairing !== null;
    };
    const remembered = rememberedConnection();
    const paired = pairFromLink();
    if (!paired && remembered) {
      setOffice({ stage: "starting", address: remembered.office });
      void enter(remembered);
    } else if (!paired) void enterOwnOffice();
    addEventListener("hashchange", pairFromLink);
    return () => removeEventListener("hashchange", pairFromLink);
  }, [connect, enter, enterOwnOffice]);

  return { office, connect, disconnect };
}
