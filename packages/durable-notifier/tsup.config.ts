import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "server/index": "src/server/index.ts" },
    format: ["esm"],
    dts: true,
    outDir: "dist",
    clean: true,
    external: ["cloudflare:workers"],
  },
  {
    entry: { "client/index": "src/client/index.ts" },
    format: ["esm"],
    dts: true,
    outDir: "dist",
    clean: false,
    external: ["react"],
  },
]);
