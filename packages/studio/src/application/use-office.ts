import { useCallback, useEffect, useState } from "preact/hooks";
import { CONTRACT } from "@skynot/contract";
import { HttpGateway } from "../adapters/http-gateway";
import { forgetConnection, officeOrigin, pair, pairingFrom, rememberConnection, rememberedConnection, type Connection } from "./connection";

export type Office =
  | { stage: "starting" }
  | { stage: "asking"; address: string; problem: string | null }
  | { stage: "mismatched"; address: string; studioContract: number; officeContract: number }
  | { stage: "connected"; gateway: HttpGateway; remote: string | null };

const SESSION_ENDED = "The office no longer accepts this session. Pair this studio with it again.";
const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : "The office could not be paired.");

export function useOffice() {
  const [office, setOffice] = useState<Office>({ stage: "starting" });

  const enter = useCallback(async (connection?: Connection) => {
    const address = connection?.office ?? location.origin;
    const gateway = new HttpGateway(connection, () => {
      forgetConnection();
      setOffice({ stage: "asking", address, problem: SESSION_ENDED });
    });
    // An office that does not answer right now is left to the console, which says so and offers to retry.
    const meta = await gateway.meta().catch(() => null);
    if (meta && meta.contract !== CONTRACT) return setOffice({ stage: "mismatched", address, studioContract: CONTRACT, officeContract: meta.contract });
    setOffice({ stage: "connected", gateway, remote: connection ? new URL(connection.office).host : null });
  }, []);

  const enterOwnOffice = useCallback(async () => {
    const meta = await new HttpGateway().meta().catch(() => null);
    if (!meta) return setOffice({ stage: "asking", address: "", problem: null });
    if (meta.requiresSession) return setOffice({ stage: "asking", address: location.origin, problem: null });
    await enter();
  }, [enter]);

  const connect = useCallback(
    async (address: string, secret: string) => {
      const origin = officeOrigin(address);
      try {
        if (!origin) throw new Error("Use the office's https address. Plain http only works for an office on this machine.");
        const connection = await pair(origin, secret);
        rememberConnection(connection);
        await enter(connection);
      } catch (cause) {
        setOffice({ stage: "asking", address: origin ?? address, problem: reasonOf(cause) });
      }
    },
    [enter],
  );

  const disconnect = useCallback(() => {
    forgetConnection();
    setOffice({ stage: "starting" });
    void enterOwnOffice();
  }, [enterOwnOffice]);

  useEffect(() => {
    const pairing = pairingFrom(location.hash);
    const remembered = rememberedConnection();
    if (/[#&]secret=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    if (pairing) void connect(pairing.office, pairing.secret);
    else if (remembered) void enter(remembered);
    else void enterOwnOffice();
  }, [connect, enter, enterOwnOffice]);

  return { office, connect, disconnect };
}
