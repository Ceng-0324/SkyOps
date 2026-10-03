import { build } from "vite";
import { spawnSync } from "node:child_process";

const smoke = process.argv.includes("--smoke");
if (smoke && !process.env.SKYOPS_TEST_API_BASE_URL) {
  throw new Error("Smoke requires SKYOPS_TEST_API_BASE_URL pointing to a real backend");
}

await build({
  configFile: false,
  define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(smoke ? process.env.SKYOPS_TEST_API_BASE_URL : "") },
  build: {
    outDir: "node_modules/.tmp/environment-tests",
    emptyOutDir: true,
    lib: { entry: "tests/environment-entry.ts", formats: ["es"], fileName: () => "environment.mjs" },
    rollupOptions: { external: ["react", "zustand", "zustand/vanilla"] },
    minify: false,
  },
});
const result = spawnSync(process.execPath, ["--test", smoke
  ? "tests/environment.smoke.mjs" : "tests/environment.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
