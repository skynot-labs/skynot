import { readFile } from "node:fs/promises";
import { GithubAppTokens, asGithubApp } from "../delivery";
import { exec, type Exec } from "../kernel/process";

// With SKYNOT_GITHUB_APP_ID and SKYNOT_GITHUB_APP_KEY (a path) the shop acts as that GitHub App; without them, as whoever gh is logged in as.
export async function githubExec(env: NodeJS.ProcessEnv = process.env): Promise<{ exec: Exec; identity: string }> {
  const appId = env.SKYNOT_GITHUB_APP_ID;
  const keyPath = env.SKYNOT_GITHUB_APP_KEY;
  if (!appId && !keyPath) return { exec, identity: "the account gh is logged in as" };
  if (!appId || !keyPath) throw new Error("set both SKYNOT_GITHUB_APP_ID and SKYNOT_GITHUB_APP_KEY, or neither");

  const privateKey = await readFile(keyPath, "utf8").catch(() => {
    throw new Error(`SKYNOT_GITHUB_APP_KEY: ${keyPath} could not be read`);
  });
  const installationId = env.SKYNOT_GITHUB_APP_INSTALLATION;
  const tokens = new GithubAppTokens({ appId, privateKey, ...(installationId && { installationId }) });
  await tokens.token();
  return { exec: asGithubApp(exec, tokens), identity: `GitHub App ${appId}` };
}
