// Runs ChatGPT through OpenAI's Codex CLI (`codex exec`), which signs in with your ChatGPT account.
// Same shapes as lib/claude.js and lib/chat.js, so the rest of Cloak doesn't care which one it's talking to:
//   runCodex(opts)  -> { proc, done } where done resolves to { json: { result, structured_output, is_error } } or { error }
//   new CodexChat() -> the chat bar's conversation (send / stop / reset / kill / warm / sessionId)
//
// Differences from Claude Code that matter here:
//  - Each message is its own `codex exec` run; later ones continue the conversation with `codex exec resume <id>`.
//  - Instructions come from AGENTS.md in the working folder (main.js writes it).
//  - Codex can't list the actions it was blocked from. So the chat runs read-only, and the instructions ask it to
//    end with "APPROVAL NEEDED: <what>" when it needs to change something. That becomes an Allow card; allowing it
//    repeats the turn with write access.
//  - Screenshots are attached as images (-i) instead of being opened with a Read tool.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { killProc } = require("./claude");
const { MAC_BIN_DIRS } = require("./platform");

const NOT_FOUND_MSG =
  "Couldn't find the Codex CLI, which Cloak uses to talk to ChatGPT. Open Settings > General and click Install next to ChatGPT, then Sign in.";
const LOGIN_MSG = "ChatGPT isn't signed in. Open Settings > General and click Sign in next to ChatGPT.";
const APPROVAL_RE = /^\s*\**APPROVAL NEEDED:?\**\s*(.+)$/gim;
const WRITE_RULE = "codex:write"; // the one permission Codex chats ask for: change files and run commands

function findCodex() {
  // CODEX_CLI_PATH lets you point at a codex install that isn't on PATH (or, for tests, a .js stand-in).
  if (process.env.CODEX_CLI_PATH && fs.existsSync(process.env.CODEX_CLI_PATH)) return process.env.CODEX_CLI_PATH;
  const found = [];
  try {
    found.push(...execFileSync(process.platform === "win32" ? "where.exe" : "which", ["codex"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch {}
  if (process.platform === "win32") found.push(path.join(process.env.APPDATA || "", "npm", "codex.cmd"));
  else found.push(...MAC_BIN_DIRS.map((d) => path.join(d, "codex")));
  const existing = found.filter((p) => fs.existsSync(p));
  return existing.find((p) => !/\.(cmd|bat)$/i.test(p) && /\.exe$/i.test(p)) || existing[0] || null;
}

const quoteForCmd = (a) => (a === "" ? '""' : /^[\w.\-\\/:=]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
function spawnCodex(args, cwd) {
  const exe = findCodex();
  if (!exe) throw new Error(NOT_FOUND_MSG);
  const env = { ...process.env };
  delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; // use the ChatGPT sign-in, never a stray key
  const opts = { cwd, env, windowsHide: true };
  if (/\.js$/i.test(exe)) return spawn(process.execPath, [exe, ...args], { ...opts, env: { ...env, ELECTRON_RUN_AS_NODE: "1" } });
  if (/\.(cmd|bat)$/i.test(exe)) return spawn([exe, ...args].map(quoteForCmd).join(" "), { ...opts, shell: true });
  return spawn(exe, args, opts);
}

// Signed in? `codex login status` exits 0 when it is. Cached briefly: Settings asks often.
let statusCache = { at: 0, value: null };
function loginStatus(force) {
  if (!force && Date.now() - statusCache.at < 30_000) return statusCache.value;
  const exe = findCodex();
  let value = { installed: !!exe, loggedIn: false, detail: "" };
  if (exe) {
    try {
      const args = ["login", "status"];
      const out = /\.js$/i.test(exe)
        ? execFileSync(process.execPath, [exe, ...args], { encoding: "utf8", windowsHide: true, timeout: 15_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] })
        : execFileSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 15_000, shell: /\.(cmd|bat)$/i.test(exe), stdio: ["ignore", "pipe", "pipe"] });
      value = { installed: true, loggedIn: true, detail: out.split(/\r?\n/).filter((l) => l && !/^WARNING/.test(l)).pop() || "" };
    } catch (e) {
      value = { installed: true, loggedIn: false, detail: String(e.stdout || e.message || "").trim().split(/\r?\n/).pop() };
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

function friendlyCodexError(t) {
  const s = String(t || "");
  if (s === NOT_FOUND_MSG) return s;
  if (/not logged in|401|unauthori[sz]ed|missing bearer|sign in|login/i.test(s)) return LOGIN_MSG;
  if (/usage limit|rate limit|quota/i.test(s)) return "You've reached your ChatGPT usage limit for now. Try again later, or switch to Claude in Settings > General.";
  if (/not recognized|ENOENT/i.test(s)) return NOT_FOUND_MSG;
  return s.replace(/,?\s*(cf-ray|request id|url):\s*\S+/gi, "").trim();
}

// Screenshots are mentioned in prompts as ./relative paths (Claude opens them with Read). Attach them instead.
function takeImages(prompt, cwd) {
  const images = [];
  const text = prompt.replace(/\.\/[^\s"'`)]+\.(?:png|jpe?g)/gi, (m) => {
    const abs = path.resolve(cwd || ".", m);
    if (fs.existsSync(abs)) images.push(abs);
    return m;
  }).replace(/\(open each with Read\)|open them with the Read tool/gi, "(attached as images, in this order)");
  return { text, images: [...new Set(images)] };
}

// Speed presets (Settings > Claude & privacy > Chat speed) and the effort names the rest of Cloak uses.
const EFFORT = { low: "low", medium: "medium", high: "high" };
function commonArgs({ effort, model, images = [], write = false, addDirs = [] }) {
  const args = ["--json", "--skip-git-repo-check", "--ignore-user-config", "-c", `sandbox_mode="${write ? "workspace-write" : "read-only"}"`, "-c", 'approval_policy="never"'];
  if (EFFORT[effort]) args.push("-c", `model_reasoning_effort="${EFFORT[effort]}"`);
  if (model) args.push("-m", model);
  // (`exec resume` has no --add-dir, so extra writable folders go through config; TOML literal strings keep backslashes.)
  if (write && addDirs.length) args.push("-c", `sandbox_workspace_write.writable_roots=[${addDirs.map((d) => `'${d}'`).join(",")}]`);
  for (const img of images) args.push("-i", img);
  return args;
}

// Reads `codex exec --json` output. onEvent gets { type: "text" | "tool" | "message" } like the Claude chat.
function readEvents(proc, onEvent, onDone) {
  let buf = "", errOut = "", threadId = null, text = "", lastMessage = "", failed = null, finished = false;
  const finish = (r) => { if (!finished) { finished = true; onDone(r); } };
  proc.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "thread.started") threadId = ev.thread_id;
      const item = ev.item || {};
      if (ev.type === "item.started" && item.type === "command_execution") onEvent({ type: "tool", name: "Bash" });
      else if (ev.type === "item.started" && item.type === "web_search") onEvent({ type: "tool", name: "WebSearch" });
      else if (ev.type === "item.started" && item.type === "file_change") onEvent({ type: "tool", name: "Edit" });
      else if (ev.type === "item.completed" && item.type === "agent_message" && item.text) {
        if (text) { onEvent({ type: "message" }); text += "\n\n"; }
        text += item.text;
        lastMessage = item.text;
        onEvent({ type: "text", text: item.text });
      } else if (ev.type === "turn.failed") failed = ev.error?.message || "ChatGPT couldn't answer.";
    }
  });
  proc.stderr.on("data", (d) => (errOut = (errOut + d).slice(-4000)));
  proc.on("error", (err) => finish({ error: err.code === "ENOENT" ? NOT_FOUND_MSG : String(err.message || err) }));
  proc.on("close", (code) => {
    if (failed) return finish({ error: failed, threadId });
    if (!text && code !== 0) return finish({ error: errOut.split(/\r?\n/).filter((l) => l && !/^WARNING/.test(l)).pop() || `codex exited with code ${code}`, threadId });
    finish({ text, lastMessage, threadId });
  });
}

/** One `codex exec` run, read-only and not saved. Same result shape as runClaude. */
function runCodex({ cwd, prompt, jsonSchema, effort, model, timeoutMs }) {
  const { text, images } = takeImages(prompt, cwd);
  const runDir = path.join(os.tmpdir(), "cloak-codex-run"); // no AGENTS.md here: one-off jobs don't get the chat's instructions
  fs.mkdirSync(runDir, { recursive: true });
  const args = ["exec", ...commonArgs({ effort, model: model && !/^(haiku|sonnet|opus)$/.test(model) ? model : null, images }), "--ephemeral", "-C", runDir];
  let schemaFile = null;
  if (jsonSchema) {
    schemaFile = path.join(runDir, `schema-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(strictSchema(jsonSchema)));
    args.push("--output-schema", schemaFile);
  }
  args.push("-");
  let proc;
  try { proc = spawnCodex(args, runDir); } catch (err) { return { proc: null, done: Promise.resolve({ error: err.message }) }; }
  const done = new Promise((resolve) => {
    let timer = null;
    const end = (r) => {
      clearTimeout(timer);
      if (schemaFile) fs.rm(schemaFile, { force: true }, () => {});
      if (r.error) return resolve({ error: r.error });
      let structured;
      if (jsonSchema) { try { structured = dropNulls(JSON.parse(r.lastMessage)); } catch {} }
      resolve({ json: { result: r.lastMessage || r.text, structured_output: structured, is_error: false } });
    };
    if (timeoutMs) timer = setTimeout(() => { killProc(proc); end({ error: `ChatGPT took longer than ${Math.round(timeoutMs / 60_000)} minutes and was stopped. Try again.` }); }, timeoutMs);
    readEvents(proc, () => {}, end);
  });
  proc.stdin.end(text);
  return { proc, done };
}

// OpenAI's structured output wants every property listed as required. Optional ones become "this type or null",
// and dropNulls() removes those nulls again, so callers see the same shape as with Claude.
function strictSchema(s) {
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s)) return s.map(strictSchema);
  const out = { ...s };
  if (out.type === "object" && out.properties) {
    const req = new Set(out.required || []);
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => {
      const p = strictSchema(v);
      return [k, req.has(k) ? p : { ...p, type: [].concat(p.type || "string", "null"), ...(p.enum ? { enum: [...p.enum, null] } : {}) }];
    }));
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  if (out.items) out.items = strictSchema(out.items);
  return out;
}
function dropNulls(v) {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)]));
  return v;
}

// Pulls "APPROVAL NEEDED: ..." lines out of a reply. Returns { text, needs: [descriptions] }.
function extractApprovals(text) {
  const needs = [];
  const cleaned = String(text || "").replace(APPROVAL_RE, (_, what) => { needs.push(what.trim()); return ""; }).replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, needs };
}

/** The chat bar's conversation with ChatGPT. getOptions() -> { cwd, effort, model, addDirs, alwaysWrite } */
class CodexChat {
  constructor(getOptions) {
    this.getOptions = getOptions;
    this.sessionId = null;
    this.proc = null;
    this.turn = null;
  }
  warm() {} // nothing to start ahead of time: each message is its own run

  // extraAllowed: ["codex:write"] when the user just allowed changes for this turn.
  send(prompt, { onEvent = () => {}, extraAllowed = [] } = {}) {
    if (this.turn) return Promise.resolve({ error: "ChatGPT is still answering the last message." });
    const opts = this.getOptions();
    const write = opts.alwaysWrite || extraAllowed.includes(WRITE_RULE);
    const { text, images } = takeImages(prompt, opts.cwd);
    const args = this.sessionId
      ? ["exec", "resume", ...commonArgs({ ...opts, images, write }), this.sessionId, "-"]
      : ["exec", ...commonArgs({ ...opts, images, write }), "-C", opts.cwd, "-"];
    let proc;
    try { proc = spawnCodex(args, opts.cwd); } catch (err) { return Promise.resolve({ error: err.message }); }
    this.proc = proc;
    return new Promise((resolve) => {
      this.turn = { resolve };
      readEvents(proc, onEvent, (r) => {
        if (this.proc === proc) this.proc = null;
        if (r.threadId) this.sessionId = r.threadId;
        const t = this.turn;
        this.turn = null;
        if (!t) return; // stopped
        if (r.error) return t.resolve({ error: r.error });
        const { text: shown, needs } = extractApprovals(r.text);
        // Same shape as a Claude result; blocked actions come back as approval requests.
        t.resolve({ json: { result: shown, is_error: false, permission_denials: write ? [] : needs.map((what, i) => ({ codex: true, tool_use_id: `cx${Date.now()}${i}`, what })) } });
      });
      proc.stdin.end(text);
    });
  }
  stop() {
    const t = this.turn;
    this.turn = null;
    this.kill();
    t?.resolve({ stopped: true });
  }
  reset() { this.sessionId = null; this.stop(); }
  kill() { if (this.proc) { const p = this.proc; this.proc = null; killProc(p); } }
}

// An approval card for a Codex "APPROVAL NEEDED" request (see permissions.js for Claude's).
function describeCodexRequest(d) {
  return {
    id: d.tool_use_id, tool: "codex", title: d.what, detail: "ChatGPT will be able to change files in your user folder and run commands for this.",
    rule: WRITE_RULE, alwaysRule: WRITE_RULE, alwaysLabel: "Always let ChatGPT make changes without asking",
  };
}

module.exports = { runCodex, CodexChat, findCodex, loginStatus, friendlyCodexError, describeCodexRequest, extractApprovals, strictSchema, WRITE_RULE, NOT_FOUND_MSG };
