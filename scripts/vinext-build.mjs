import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";

const localCommand = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "vinext.cmd" : "vinext");
const command = existsSync(localCommand) ? localCommand : process.platform === "win32" ? "vinext.cmd" : "vinext";
const result = spawnSync(command, ["build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(result.status ?? 1);
