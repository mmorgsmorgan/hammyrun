import fs from "node:fs";
import { spawn } from "node:child_process";
fs.chmodSync("/tmp/hammy-cloudflared", 0o755);
const child = spawn(
  "/tmp/hammy-cloudflared",
  ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4187"],
  { stdio: "inherit" },
);
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code) => process.exit(code || 0));
