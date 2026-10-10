import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "examples/**", "projects/**", "console/e2e/**", "data/**", ".claude/**"],
  },
});
