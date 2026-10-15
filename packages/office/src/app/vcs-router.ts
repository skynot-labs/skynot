import type { Vcs } from "../delivery";

// Projects on this machine go to their bare repository; every other one to GitHub.
export function routeVcs(isLocal: (repo: string) => boolean, local: Vcs, remote: Vcs): Vcs {
  const to = (repo: string) => (isLocal(repo) ? local : remote);
  return {
    createIssue: (repo, title, body) => to(repo).createIssue(repo, title, body),
    pullRequestState: (repo, number) => to(repo).pullRequestState(repo, number),
    pullRequestConflicts: (repo, number) => to(repo).pullRequestConflicts(repo, number),
    pullRequestDiff: (repo, number) => to(repo).pullRequestDiff(repo, number),
    pullRequestChecks: (repo, number) => to(repo).pullRequestChecks(repo, number),
    commentOnPullRequest: (repo, number, text) => to(repo).commentOnPullRequest(repo, number, text),
    listTickets: (repo, label) => to(repo).listTickets(repo, label),
    addLabel: (repo, issue, label) => to(repo).addLabel(repo, issue, label),
    openPullRequest: (repo, pullRequest) => to(repo).openPullRequest(repo, pullRequest),
  };
}
