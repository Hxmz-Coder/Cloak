// macOS: apps opened from Finder, the Dock or at login get a bare PATH (/usr/bin:/bin:/usr/sbin:/sbin), not the one
// your Terminal has, so `claude`, `codex`, `npm` and `node` aren't found. Ask the login shell for its PATH once and
// add the usual install folders, before anything is started. Nothing changes on Windows.
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const MAC_BIN_DIRS = [
  path.join(os.homedir(), ".local", "bin"), // Claude Code's installer, and Codex installed by Cloak
  path.join(os.homedir(), ".claude", "local"), // older Claude Code installs
  "/opt/homebrew/bin", // Homebrew on Apple silicon
  "/usr/local/bin", // Homebrew on Intel, and the Node.js installer from nodejs.org
  path.join(os.homedir(), ".npm-global", "bin"),
];

function loginShellPath() {
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", "printf '__PATH__%s' \"$PATH\""], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("__PATH__").pop().trim(); // anything a profile prints comes before the marker
  } catch { return ""; }
}

function fixMacPath() {
  if (process.platform !== "darwin") return;
  const dirs = [...loginShellPath().split(":"), ...(process.env.PATH || "").split(":"), ...MAC_BIN_DIRS].filter(Boolean);
  process.env.PATH = [...new Set(dirs)].join(":");
}

module.exports = { fixMacPath, MAC_BIN_DIRS };
