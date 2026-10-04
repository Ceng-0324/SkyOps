// Run UI flows sequentially: concurrent CDP pages can steal focus and suspend animation frames.
// Requires the application, its backend proxy, and Chrome with remote debugging already running.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const script of ["test-home-browser.mjs", "test-spatial-task-browser.mjs", "test-scene-browser.mjs", "test-spatial-plans-browser.mjs"]) {
  console.log(`Browser regression: ${script}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { stdio: "inherit", timeout: 180_000 });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
