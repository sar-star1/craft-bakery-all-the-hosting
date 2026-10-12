// Runs every tests/*.test.mjs in its own process: `npm test`.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dir = new URL("./", import.meta.url).pathname;
let failed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort()) {
  console.log(`\n=== ${file}`);
  const r = spawnSync(process.execPath, ["--conditions=react-server", "--no-warnings", dir + file], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) FAILED` : "\nAll test files passed");
process.exit(failed ? 1 : 0);
