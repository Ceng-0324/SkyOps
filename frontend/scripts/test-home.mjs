import { build } from "vite";
import { spawnSync } from "node:child_process";

await build({
  configFile: false,
  build: {
    outDir: "node_modules/.tmp/home-tests", emptyOutDir: true,
    lib: { entry: "tests/home-entry.ts", formats: ["es"], fileName: () => "drafts.mjs" },
    rollupOptions: { external: ["react"] }, minify: false,
  },
});
const result = spawnSync(process.execPath, ["--test", "tests/home.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
