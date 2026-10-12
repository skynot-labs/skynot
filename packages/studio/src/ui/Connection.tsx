import { useState } from "preact/hooks";
import { Brand } from "../design/Brand";
import { publicUrls } from "../github/links";
import "./connection.css";

const CONNECTING_GUIDE = `${publicUrls.repository}/blob/main/docs/connecting-a-studio.md`;

export function ConnectionScreen({
  address,
  secret,
  problem,
  onConnect,
}: {
  address: string;
  secret: string;
  problem: string | null;
  onConnect: (address: string, secret: string) => Promise<void>;
}) {
  const [office, setOffice] = useState(address);
  const [typedSecret, setTypedSecret] = useState(secret);
  function submit(event: Event) {
    event.preventDefault();
    void onConnect(office, typedSecret);
  }
  return (
    <main class="connection-screen">
      <form class="connection-card" onSubmit={submit}>
        <Brand />
        <div class="eyebrow">STUDIO · NOT CONNECTED</div>
        <h1>Connect to your office.</h1>
        <p class="form-note">
          The office is the part of skynot you run yourself: the Manager, the
          workers and the log. Started with an address, it prints a pairing
          link; opening that link fills this in and connects by itself. The
          secret is also kept in the file <code>pairing.secret</code> in the
          office's data folder.{" "}
          <a href={CONNECTING_GUIDE} target="_blank" rel="noreferrer">
            How to connect a studio
          </a>
        </p>
        {problem && (
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
          value={typedSecret}
          onInput={(event) => setTypedSecret(event.currentTarget.value)}
          required
        />
        <div class="modal-actions">
          <button class="primary-button" type="submit">
            Connect
          </button>
        </div>
      </form>
    </main>
  );
}

export function Connecting({ address }: { address: string | null }) {
  return (
    <main class="connection-screen">
      <div class="connection-card" role="status">
        <Brand />
        <div class="eyebrow">STUDIO · CONNECTING</div>
        <h1>
          {address ? `Connecting to ${new URL(address).host}…` : "Connecting…"}
        </h1>
      </div>
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
  const servedByThisOffice = address === location.origin;
  const studioIsOlder = studioContract < officeContract;
  return (
    <main class="connection-screen">
      <div class="connection-card">
        <Brand />
        <div class="eyebrow">STUDIO · DIFFERENT VERSIONS</div>
        <h1>This studio and the office are different versions.</h1>
        <p class="form-note">
          This studio is version {studioContract}; the office at{" "}
          {new URL(address).host} is version {officeContract}.{" "}
          {studioIsOlder ? "The studio is the older one." : "The office is the older one."}
        </p>
        <p class="form-note">{remedy(servedByThisOffice, studioIsOlder)}</p>
        <div class="modal-actions">
          {servedByThisOffice ? (
            <button class="primary-button" type="button" onClick={() => location.reload()}>
              Reload
            </button>
          ) : (
            <>
              <button class="text-button" type="button" onClick={onLeave}>
                Use another office
              </button>
              <a class="primary-button" href={address}>
                Open the office's own console
              </a>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function remedy(servedByThisOffice: boolean, studioIsOlder: boolean) {
  if (servedByThisOffice && studioIsOlder) {
    return (
      <>
        The office serves this studio from its last build. Run <code>npm run build:console</code>, restart the office
        and reload this page.
      </>
    );
  }
  if (servedByThisOffice) return "The office has been running since before this studio was rebuilt. Restart it and reload this page.";
  if (studioIsOlder) return "Reload this page to get the studio's latest build. If they still differ, open the console the office serves itself.";
  return (
    <>
      Update the office: <code>git pull</code>, <code>npm ci</code>, and start it again.
    </>
  );
}
