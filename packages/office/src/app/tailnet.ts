import { err, ok, type Result } from "../kernel";
import { TIMED_OUT, type Exec } from "../kernel/process";

const JOIN = "sudo tailscale up --operator=$USER";

// Shares the console's port inside the director's tailnet and says the HTTPS address it is now reached at.
// The error is what to do next, in words to print.
export async function shareOnTailnet(exec: Exec, port: number): Promise<Result<string, string>> {
  const status = await exec("tailscale", ["status", "--json"], { timeoutMs: 10_000 }).catch(() => null);
  if (status === null) return err("Tailscale is not installed on this machine. Install it from https://tailscale.com/download, then run:\n  " + JOIN);

  if (/failed to connect to local tailscaled/i.test(`${status.stdout}\n${status.stderr}`)) {
    return err("Tailscale is installed, but its daemon is not running, so a login it already has cannot be used. Start it and try again:\n  sudo systemctl start tailscaled\nIn the devcontainer:\n  bash .devcontainer/start-tailscale.sh");
  }

  const name = dnsNameIn(status.stdout);
  if (name === null) return err(`This machine has not joined a tailnet yet. Run:\n  ${JOIN}`);

  const shared = await exec("tailscale", ["serve", "--bg", String(port)], { timeoutMs: 20_000 }).catch(() => null);
  if (shared?.code === 0) return ok(`https://${name}`);

  const said = `${shared?.stdout ?? ""}\n${shared?.stderr ?? ""}`.trim();
  // Until Serve is enabled for the tailnet the command prints where to enable it and waits.
  if (shared?.code === TIMED_OUT || /not enabled/i.test(said)) return err(`Tailscale could not share port ${port} yet:\n${said}\nOpen that link, accept, and start again.`);
  if (/access denied|operator/i.test(said)) return err(`This user may not change what Tailscale shares. Run once:\n  sudo tailscale set --operator=$USER`);
  return err(`Tailscale could not share port ${port}:\n${said || "it gave no reason"}`);
}

function dnsNameIn(statusJson: string): string | null {
  try {
    const status = JSON.parse(statusJson) as { BackendState?: unknown; Self?: { DNSName?: unknown } };
    const name = status.Self?.DNSName;
    return status.BackendState === "Running" && typeof name === "string" && name ? name.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}
