// Starts the panel on PANEL_PORT (default 3100), so two instances of the prospector can run side by side.
import { spawn } from "node:child_process";
const port = process.env.PANEL_PORT ?? "3100";
const child = spawn("npx", ["next", "dev", "--port", port], { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
