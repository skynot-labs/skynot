import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

const apiTarget = process.env.SKYNOT_API_TARGET ?? "http://127.0.0.1:4747";

// The studio talks to an office the director names, so any https origin, and an office on this machine over http.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Only the built page carries the policy: the dev server injects styles and a socket the policy would refuse.
const contentSecurityPolicy: Plugin = {
  name: "skynot-content-security-policy",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY }, injectTo: "head-prepend" }],
};

export default defineConfig({
  root: "console",
  plugins: [preact(), contentSecurityPolicy],
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
