import { useState } from "preact/hooks";
import { Brand } from "../design/Brand";
import "./connection.css";

export function ConnectionScreen({
  address,
  problem,
  onConnect,
}: {
  address: string;
  problem: string | null;
  onConnect: (address: string, secret: string) => Promise<void>;
}) {
  const [office, setOffice] = useState(address);
  const [secret, setSecret] = useState("");
  const [pairing, setPairing] = useState(false);
  async function submit(event: Event) {
    event.preventDefault();
    setPairing(true);
    await onConnect(office, secret);
    setPairing(false);
  }
  return (
    <main class="connection-screen">
      <form class="connection-card" onSubmit={submit}>
        <Brand />
        <div class="eyebrow">STUDIO · NOT CONNECTED</div>
        <h1>Connect to your office.</h1>
        <p class="form-note">
          The office prints a pairing link when it starts. Opening that link
          fills this in and connects by itself.
        </p>
        {problem && !pairing && (
          <div class="error-banner" role="alert">
            <p>{problem}</p>
          </div>
        )}
        <label class="form-label" for="officeAddress">
          OFFICE ADDRESS
        </label>
        <input
          id="officeAddress"
          type="text"
          inputMode="url"
          autocomplete="url"
          spellcheck={false}
          placeholder="https://office.example.ts.net"
          value={office}
          onInput={(event) => setOffice(event.currentTarget.value)}
          required
        />
        <label class="form-label" for="pairingSecret">
          PAIRING SECRET
        </label>
        <input
          id="pairingSecret"
          type="password"
          autocomplete="off"
          value={secret}
          onInput={(event) => setSecret(event.currentTarget.value)}
          required
        />
        <div class="modal-actions">
          <button class="primary-button" type="submit" disabled={pairing}>
            {pairing ? "Connecting…" : "Connect"}
          </button>
        </div>
        <p class="form-note">
          Your browser may ask once for permission to reach devices on your
          local network. That is expected when the office is on a private
          network.
        </p>
      </form>
    </main>
  );
}

export function ContractMismatch({
  address,
  studioContract,
  officeContract,
  onLeave,
}: {
  address: string;
  studioContract: number;
  officeContract: number;
  onLeave: () => void;
}) {
  return (
    <main class="connection-screen">
      <div class="connection-card">
        <Brand />
        <div class="eyebrow">STUDIO · DIFFERENT VERSION</div>
        <h1>This studio and the office do not match.</h1>
        <p class="form-note">
          This studio speaks contract {studioContract}; the office at{" "}
          {new URL(address).host} speaks contract {officeContract}. The console
          the office serves itself always matches it.
        </p>
        <div class="modal-actions">
          <button class="text-button" type="button" onClick={onLeave}>
            Use another office
          </button>
          <a class="primary-button" href={address}>
            Open the office's own console
          </a>
        </div>
      </div>
    </main>
  );
}
