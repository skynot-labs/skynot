import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suites live in each package and in the root's own folder; anything else that looks like a test (a worktree, a cloned project, research) is not ours to run.
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
});
