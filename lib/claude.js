// Runs Claude through the Claude Code CLI (`claude -p`), which uses your Claude Pro login.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const NOT_FOUND_MSG =
  "Couldn't find the Claude Code CLI (`claude`). Install Claude Code, then open a terminal, run `claude`, " +
  "and type `/login` to sign in with your Claude Pro account. Restart this widget afterwards.";
const LOGIN_MSG =
  "Claude Code isn't signed in. Open a terminal, run `claude`, and type `/login` to sign in with your Claude Pro account, then try again.";
const API_KEY_MSG =
  "Claude Code is set up to use an API key rather than your Claude Pro subscription. In a terminal, run `claude`, " +
  "type `/logout`, then `/login` and choose your Claude account (not Anthropic Console / API).";

// Env vars that would make the CLI bill the API (or a cloud provider) instead of your subscription.
// They are removed from the environment the CLI runs in.
const BILLING_ENV_VARS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
];

function findClaude() {
  // CLAUDE_CLI_PATH lets you point at a claude install that isn't on PATH.
  if (process.env.CLAUDE_CLI_PATH && fs.existsSync(process.env.CLAUDE_CLI_PATH)) return process.env.CLAUDE_CLI_PATH;
  const found = [];
  try {
    found.push(...execFileSync(process.platform === "win32" ? "where.exe" : "which", ["claude"], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch {}
  found.push(
    path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"),
    path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
  );
  const existing = found.filter((p) => fs.existsSync(p));
  // Prefer a real executable; npm's .cmd shim needs a shell on Windows.
  return existing.find((p) => !/\.(cmd|bat)$/i.test(p)) || existing[0] || null;
}

function cliEnv() {
  const env = { ...process.env };
  for (const k of BILLING_ENV_VARS) delete env[k];
  return env;
}

function quoteForCmd(arg) {
  if (arg === "") return '""';
  return /^[\w.\-\\/:]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

// Turns CLI auth failures into a clear instruction; passes other errors through unchanged.
function friendlyError(t) {
  if (t === NOT_FOUND_MSG) return t;
  if (/invalid api key|external api key|apiKeyHelper/i.test(t || "")) return API_KEY_MSG;
  if (/log ?in|\/login|not authenticated|unauthori[sz]ed|oauth|credential|\b401\b/i.test(t || "")) return LOGIN_MSG;
  return t;
}

/**
 * One `claude -p` run. The prompt goes in on stdin (same as `claude -p "<prompt>"`, minus Windows quoting issues).
 * Anything not covered by `allowedTools` that would need a permission prompt is denied automatically and
 * reported back in `permission_denials`, which the widget turns into an approval card.
 *
 * Returns { proc, done } where done resolves to { json } or { error }.
 */
function runClaude({ cwd, prompt, resume, tools, allowedTools = [], addDirs = [], systemPromptFile, jsonSchema, effort, persist = true }) {
  const exe = findClaude();
  if (!exe) return { proc: null, done: Promise.resolve({ error: NOT_FOUND_MSG }) };

  const args = [
    "-p",
    "--output-format", "json",
    "--tools", tools,
    "--permission-mode", "default",
    "--permission-prompts", "none", // nobody can answer a prompt here, so it's denied and reported instead
    "--strict-mcp-config",          // no MCP servers
    "--setting-sources", "local",   // skip user/project settings (hooks, allow rules, apiKeyHelper)
    "--disable-slash-commands",
  ];
  if (systemPromptFile) args.push("--system-prompt-file", systemPromptFile);
  if (allowedTools.length) args.push("--allowedTools", ...allowedTools);
  if (addDirs.length) args.push("--add-dir", ...addDirs);
  if (jsonSchema) args.push("--json-schema", JSON.stringify(jsonSchema));
  if (effort) args.push("--effort", effort);
  if (!persist) args.push("--no-session-persistence");
  if (resume) args.push("--resume", resume);

  const opts = { cwd, env: cliEnv(), windowsHide: true };
  let proc;
  try {
    proc = /\.(cmd|bat)$/i.test(exe)
      ? spawn([exe, ...args].map(quoteForCmd).join(" "), { ...opts, shell: true })
      : spawn(exe, args, opts);
  } catch (err) {
    return { proc: null, done: Promise.resolve({ error: err.code === "ENOENT" ? NOT_FOUND_MSG : String(err.message || err) }) };
  }

  const done = new Promise((resolve) => {
    let out = "", errOut = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (errOut += d));
    proc.on("error", (err) => resolve({ error: err.code === "ENOENT" ? NOT_FOUND_MSG : String(err.message || err) }));
    proc.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(out.trim().split(/\r?\n/).pop()); } catch {}
      if (json) return resolve({ json });
      const text = (errOut || out).trim();
      if (/not recognized|command not found|ENOENT/i.test(text)) return resolve({ error: NOT_FOUND_MSG });
      resolve({ error: text || `claude exited with code ${code}` });
    });
  });
  proc.stdin.end(prompt);
  return { proc, done };
}

function killProc(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
  else proc.kill();
}

module.exports = { runClaude, killProc, friendlyError, NOT_FOUND_MSG };
