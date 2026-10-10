import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const apiTarget = process.env.SKYNOT_API_TARGET ?? "http://127.0.0.1:4747";

export default defineConfig({
  root: "console",
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          // The API refuses a POST whose Origin is not its own host; only this dev server's origin is rewritten.
          proxy.on("proxyReq", (proxyRequest, request) => {
            const origin = request.headers.origin;
            if (origin && URL.canParse(origin) && new URL(origin).host === request.headers.host) proxyRequest.setHeader("origin", apiTarget);
          });
        },
      },
    },
  },
});
