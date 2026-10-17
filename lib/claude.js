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

// How Claude is paid for, chosen in the welcome setup or Settings:
//  - "subscription": your Claude Pro/Max login in Claude Code (any API key settings are removed)
//  - "apiKey": your Anthropic API key, passed only to the CLI
// In API-key mode Claude Code gets its own config folder (configDir). Otherwise, if you're also signed in with a
// Claude account, Claude Code quietly uses that sign-in instead of the key.
let auth = { mode: "subscription", apiKey: null, configDir: null };
function setAuth(next) {
  auth = { mode: next?.mode === "apiKey" ? "apiKey" : "subscription", apiKey: next?.apiKey || null, configDir: next?.configDir || null };
}

function cliEnv() {
  const env = { ...process.env };
  for (const k of BILLING_ENV_VARS) delete env[k];
  if (auth.mode === "apiKey" && auth.apiKey) {
    env.ANTHROPIC_API_KEY = auth.apiKey;
    if (auth.configDir) env.CLAUDE_CONFIG_DIR = auth.configDir;
  }
  return env;
}

function quoteForCmd(arg) {
  if (arg === "") return '""';
  return /^[\w.\-\\/:]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

// Turns CLI auth failures into a clear instruction; passes other errors through unchanged.
function friendlyError(t) {
  if (t === NOT_FOUND_MSG) return t;
  if (auth.mode === "apiKey" && /invalid api key|authentication|unauthori[sz]ed|\b401\b/i.test(t || ""))
    return "Your Anthropic API key was rejected. Check it in Settings > General > Sign-in.";
  if (auth.mode === "apiKey" && /credit balance|billing/i.test(t || ""))
    return "Your Anthropic API account is out of credit. Add credit at console.anthropic.com, or switch to your Claude subscription in Settings > General.";
  if (/invalid api key|external api key|apiKeyHelper/i.test(t || "")) return API_KEY_MSG;
  if (/log ?in|\/login|not authenticated|unauthori[sz]ed|oauth|credential|\b401\b/i.test(t || "")) return LOGIN_MSG;
  return t;
}

// Flags shared by every run. Anything not covered by `allowedTools` that would need a permission prompt is
// denied automatically and reported back in `permission_denials`, which the widget turns into an approval card.
function baseArgs({ tools, allowedTools = [], addDirs = [], systemPromptFile, jsonSchema, effort, model, persist = true, resume }) {
  const args = [
    "-p",
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
  if (model) args.push("--model", model);
  if (!persist) args.push("--no-session-persistence");
  if (resume) args.push("--resume", resume);
  return args;
}

// Starts the CLI. Throws NOT_FOUND_MSG if it isn't installed.
function spawnClaude(args, cwd) {
  const exe = findClaude();
  if (!exe) throw new Error(NOT_FOUND_MSG);
  const opts = { cwd, env: cliEnv(), windowsHide: true };
  try {
    return /\.(cmd|bat)$/i.test(exe)
      ? spawn([exe, ...args].map(quoteForCmd).join(" "), { ...opts, shell: true })
      : spawn(exe, args, opts);
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? NOT_FOUND_MSG : String(err.message || err));
  }
}

/**
 * One `claude -p` run. The prompt goes in on stdin (same as `claude -p "<prompt>"`, minus Windows quoting issues).
 * Returns { proc, done } where done resolves to { json } or { error }.
 */
function runClaude({ cwd, prompt, ...opts }) {
  let proc;
  try {
    proc = spawnClaude([...baseArgs(opts), "--output-format", "json"], cwd);
  } catch (err) {
    return { proc: null, done: Promise.resolve({ error: err.message }) };
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

module.exports = { runClaude, baseArgs, spawnClaude, killProc, friendlyError, findClaude, setAuth, NOT_FOUND_MSG };
