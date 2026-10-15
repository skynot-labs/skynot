# 0003 · A project can live on this machine, without GitHub

**Status:** accepted.

**Context.** Every project names a GitHub repository, and the shop files an issue, opens a pull request and
waits for a merge there. Starting something new therefore means creating a repository, giving the shop's
identity access to it and registering it before the Manager can say a word, and an empty repository has no
base branch to start from. The director wants to begin a product from nothing and let the shop take it as far
as it can, publishing it only once there is something worth publishing.

**Decision.** A project's `project.yaml` says `local: true` instead of `repo`. The office keeps its
repository as a bare git repository in its data folder, created on first start with one empty commit on the
base branch, and that is the origin the workspaces clone and push to. A local adapter of the `Vcs` port
plays GitHub's part with git and a small file next to the repository: the order is its own ticket, a pull
request is the order's branch, its diff is the branch against the base, it is merged when the director
merges it from the studio (a squash onto the base branch, so history stays linear), and it conflicts when
git cannot merge it. There are no checks, no intake from issues and no board. The project's key is its id,
which has no slash and so never matches a GitHub repository.

**Alternatives.**
- *Create the GitHub repository for the director.* It needs an organization and an identity allowed to
  create repositories, which is phase 6, and it publishes something before it exists.
- *A plain folder without git.* Workers, review and recovery are built on branches; without them every
  piece would need a second path.
- *Keep the pull requests in the event log.* They are the adapter's emulation of GitHub, not the shop's
  domain; the log already records what the shop did with them.

**Consequences.**
- The director reads and runs the work by cloning the bare repository; publishing is adding a GitHub
  remote and pushing, with nothing to migrate. Moving the project to `repo: owner/name` afterwards starts
  its pull requests over on GitHub.
- Merging becomes a command of a real office, for local projects only.
- Nothing here lets a worker install a dependency, which a project started from nothing needs on its first
  order; that is decided separately.
