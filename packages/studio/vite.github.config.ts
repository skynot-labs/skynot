import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: at("./github"),
  base: "./",
  publicDir: at("./public"),
  plugins: [preact()],
  build: {
    outDir: at("./dist/github"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        project: at("./github/index.html"),
        organization: at("./github/organization/index.html"),
        app: at("./github/app/index.html"),
      },
    },
  },
});
