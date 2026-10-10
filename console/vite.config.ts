import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "console",
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:4747", changeOrigin: true } },
  },
});
