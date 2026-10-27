// Opens a visible terminal window that runs a script (installers and sign-in).
// Windows: a PowerShell window. The script goes in a temp .ps1 file and the window is opened with `start`, which
// reliably gives it its own console; a PowerShell spawned directly with no console attached quits before running anything.
// macOS: a Terminal.app window running a temp bash script (the caller passes a bash script there).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function openTerminal(script, opts = {}) {
  return process.platform === "darwin" ? openMacTerminal(script, opts) : openWindowsTerminal(script, opts);
}

function tempScript(ext, text, mode) {
  const file = path.join(os.tmpdir(), `cloak-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
  fs.writeFileSync(file, text, { mode });
  setTimeout(() => fs.rm(file, { force: true }, () => {}), 10 * 60_000);
  return file;
}

function openWindowsTerminal(script, { env = process.env, title = "Cloak", keepOpen = true } = {}) {
  const file = tempScript("ps1", "﻿" + script); // BOM: keeps non-ASCII text intact in Windows PowerShell
  const ps = `powershell.exe ${keepOpen ? "-NoExit " : ""}-NoProfile -ExecutionPolicy Bypass -File "${file}"`;
  // cmd's own quoting rules, so the command line is passed exactly as written.
  spawn("cmd.exe", [`/d /s /c "start "${title}" ${ps}"`], { windowsVerbatimArguments: true, windowsHide: true, detached: true, stdio: "ignore", env }).unref();
  return file;
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const appleQuote = (s) => `"${String(s).replace(/[\\"]/g, "\\$&")}"`;

function openMacTerminal(script, { env = process.env } = {}) {
  // Terminal.app starts its own shell from your profile, so Cloak's environment doesn't carry over; what the caller
  // took out of `env` (e.g. an API key) is unset in the script instead. The window stays open when the script ends.
  const unset = Object.keys(process.env).filter((k) => !(k in env) && /^\w+$/.test(k));
  const file = tempScript("sh", (unset.length ? `unset ${unset.join(" ")}\n` : "") + script + "\n", 0o700);
  spawn("osascript", ["-e", `tell application "Terminal" to do script ${appleQuote(`bash ${shQuote(file)}`)}`, "-e", 'tell application "Terminal" to activate'],
    { detached: true, stdio: "ignore" }).unref();
  return file;
}

module.exports = { openTerminal, shQuote };
