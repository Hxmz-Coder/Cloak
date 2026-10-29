// The chat bar's Claude: one long-running `claude -p` process in stream-json mode, so each message skips the
// CLI's ~3 second start-up, and replies stream in as they're written. The process is started ahead of time
// (warm) and restarted (resuming the same conversation) when its settings change.
const { baseArgs, spawnClaude, killProc, NOT_FOUND_MSG } = require("./claude");

class ChatSession {
  // getOptions() -> { cwd, tools, allowedTools, addDirs, systemPromptFile, model, effort }
  constructor(getOptions) {
    this.getOptions = getOptions;
    this.sessionId = null;
    this.lastContext = 0;   // tokens the latest request sent (the conversation so far)
    this.proc = null;
    this.procKey = "";      // the options the running process was started with
    this.turn = null;       // { resolve, onEvent, text }
    this.buf = "";
    this.errOut = "";
    this.extraAllowed = []; // one-off permissions for the next turn only
  }

  // Start (or restart) the process if it isn't running with the current options.
  warm() {
    const opts = this.getOptions();
    const allowed = [...opts.allowedTools, ...this.extraAllowed];
    // (The session id isn't part of the key: a running process already continues its own conversation.)
    const key = JSON.stringify({ ...opts, allowedTools: allowed });
    if (this.proc && this.proc.exitCode === null && this.procKey === key) return;
    this.kill();
    let proc;
    try {
      proc = spawnClaude([
        ...baseArgs({ ...opts, allowedTools: allowed, resume: this.sessionId }),
        "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      ], opts.cwd);
    } catch (err) {
      this.startError = err.message;
      return;
    }
    this.startError = null;
    this.proc = proc;
    this.procKey = key;
    this.buf = "";
    this.errOut = "";
    proc.stdout.on("data", (d) => this.onData(proc, d));
    proc.stderr.on("data", (d) => { if (proc === this.proc) this.errOut = (this.errOut + d).slice(-4000); });
    proc.on("error", (err) => this.onExit(proc, err.code === "ENOENT" ? NOT_FOUND_MSG : String(err.message || err)));
    proc.on("close", () => this.onExit(proc));
  }

  onData(proc, d) {
    if (proc !== this.proc) return;
    this.buf += d;
    const lines = this.buf.split("\n");
    this.buf = lines.pop();
    for (const line of lines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.session_id) this.sessionId = msg.session_id;
      if (!this.turn) continue;
      if (msg.type === "stream_event") {
        const ev = msg.event || {};
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") this.turn.onEvent({ type: "text", text: ev.delta.text });
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") this.turn.onEvent({ type: "tool", name: ev.content_block.name });
        if (ev.type === "message_start") {
          const u = ev.message?.usage || {};
          this.lastContext = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          this.turn.onEvent({ type: "message" });
        }
      } else if (msg.type === "result") {
        const t = this.turn;
        this.turn = null;
        t.resolve({ json: msg });
        // One-off permissions only apply to the turn they were granted for.
        if (this.extraAllowed.length) { this.extraAllowed = []; setTimeout(() => this.warm(), 0); }
      }
    }
  }

  onExit(proc, error) {
    if (proc !== this.proc) return;
    this.proc = null;
    if (this.turn) {
      const t = this.turn;
      this.turn = null;
      t.resolve({ error: error || this.errOut.trim() || "Claude stopped unexpectedly. Try again." });
    }
  }

  // Sends one message. onEvent gets { type: "text", text } chunks and { type: "tool", name } as Claude works.
  // Resolves to { json } (the CLI's result message) or { error }.
  send(prompt, { onEvent = () => {}, extraAllowed = [] } = {}) {
    if (this.turn) return Promise.resolve({ error: "Claude is still answering the last message." });
    this.extraAllowed = extraAllowed;
    this.warm();
    if (!this.proc) return Promise.resolve({ error: this.startError || NOT_FOUND_MSG });
    return new Promise((resolve) => {
      this.turn = { resolve, onEvent };
      this.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\n");
    });
  }

  // Stops the current answer. The conversation continues on the next message.
  stop() {
    const t = this.turn;
    this.turn = null;
    this.kill();
    t?.resolve({ stopped: true });
    setTimeout(() => this.warm(), 300);
  }

  // Forget the conversation and start fresh.
  reset() {
    this.sessionId = null;
    this.stop();
  }

  kill() {
    if (this.proc) { const p = this.proc; this.proc = null; killProc(p); }
  }
}

module.exports = { ChatSession };
