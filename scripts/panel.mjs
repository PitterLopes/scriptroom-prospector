// Starts the panel on PANEL_PORT (default 3100), so two instances of the prospector can run side by side.
// The variable may come from the environment or from the project's .env, which npm does not load by itself.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
let port = process.env.PANEL_PORT;
if (!port && existsSync(".env")) {
  const match = /^PANEL_PORT=(\d+)\s*$/m.exec(readFileSync(".env", "utf8"));
  if (match) port = match[1];
}
port ??= "3100";
const child = spawn("npx", ["next", "dev", "--port", port], { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
