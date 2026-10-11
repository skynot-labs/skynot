import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suites live in two folders; anything else that looks like a test (a worktree, a cloned project, research) is not ours to run.
    include: ["test/**/*.test.ts", "console/test/**/*.test.ts"],
  },
});
