import { defineConfig } from "tsup";
export default defineConfig({ entry: { "index": "src/index.ts", "bin/cli": "bin/cli.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: true, target: "node22" });
