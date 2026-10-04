import { build } from "vite";
import { spawnSync } from "node:child_process";

const smoke = process.argv.includes("--smoke");
if (smoke && !process.env.SKYOPS_TEST_API_BASE_URL) throw new Error("Smoke requires SKYOPS_TEST_API_BASE_URL");
await build({
  configFile: false,
  esbuild: { jsx: "automatic" },
  define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(smoke ? process.env.SKYOPS_TEST_API_BASE_URL : "") },
  build: {
    outDir: "node_modules/.tmp/workspace-tests", emptyOutDir: true,
    lib: { entry: "tests/workspace-entry.ts", formats: ["es"], fileName: () => "workspace.mjs" },
    rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom/server", "zustand", "zustand/vanilla"] }, minify: false,
  },
});
const result = spawnSync(process.execPath, ["--test", smoke ? "tests/workspace.smoke.mjs" : "tests/workspace.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
