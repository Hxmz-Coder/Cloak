// Opens a visible PowerShell window that runs a script (installers and sign-in). The script goes in a temp .ps1
// file and the window is opened with `start`, which reliably gives it its own console; a PowerShell spawned
// directly with no console attached quits before running anything.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function openTerminal(script, { env = process.env, title = "Cloak", keepOpen = true } = {}) {
  const file = path.join(os.tmpdir(), `cloak-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.ps1`);
  fs.writeFileSync(file, "﻿" + script); // BOM: keeps non-ASCII text intact in Windows PowerShell
  const ps = `powershell.exe ${keepOpen ? "-NoExit " : ""}-NoProfile -ExecutionPolicy Bypass -File "${file}"`;
  // cmd's own quoting rules, so the command line is passed exactly as written.
  spawn("cmd.exe", [`/d /s /c "start "${title}" ${ps}"`], { windowsVerbatimArguments: true, windowsHide: true, detached: true, stdio: "ignore", env }).unref();
  setTimeout(() => fs.rm(file, { force: true }, () => {}), 10 * 60_000);
  return file;
}

module.exports = { openTerminal };
