// Listen: what's playing on your computer (a class, a meeting, a video) turned into text on this PC, with the AI
// responding to it: answering questions that were just asked, flagging deadlines, pulling out tasks.
//
// The Listen panel (listen.js) captures the computer's sound and sends short clips here. This file installs the
// speech engine the first time (into <userData>/voice, ~500 MB, so it isn't part of every Cloak install),
// runs it (lib/voice-engine.mjs), keeps the transcript, and decides when to ask the AI for a response.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { utilityProcess } = require("electron");

const ENGINE_PACKAGE = "@huggingface/transformers@4.3.1";
const KEEP_MS = 3 * 3600_000;    // transcript kept in memory for 3 hours (never written to disk)
const RESPOND_EVERY_MS = 40_000; // automatic responses: at most this often...
const RESPOND_MIN_WORDS = 30;    // ...and only after this much new speech

const ANSWER_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string", description: "Exactly what the user should say out loud, word for word. Empty if it isn't a real question that needs an answer." } },
  required: ["answer"],
  additionalProperties: false,
};
// The most recent question in some transcribed speech: ends with "?" (Whisper adds them), or starts like one.
const QUESTION_START = /^(who|what|when|where|why|how|which|whose|whom|can|could|does|do|is|are|was|were|will|would|should|did|has|have|anyone|anybody|does anyone)\b/i;
function lastQuestion(text) {
  const parts = String(text).split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i];
    if (s.split(/\s+/).length < 3) continue;
    if (s.endsWith("?") || (QUESTION_START.test(s) && !s.endsWith("."))) return s;
  }
  return null;
}

// Small talk isn't a question to answer for the user (and the AI doesn't always agree on that, so it's skipped here).
const SMALL_TALK = /^(\W*(okay|ok|so|well|alright|hey|hi|hello)\W+)*(how are (you|y'?all|we|things)|how('s| is| was) (it going|everyone|your (day|weekend|morning))|how (are you|you) doing|what'?s up|how have you been|you good|everyone (good|ready))\b/i;

// Whisper's well-known inventions on silence and music.
const JUNK = /^\s*([[(][^\])]*[\])]|\.+|you|thank you\.?|thanks for watching!?|bye\.?)\s*$/i;

const LISTEN_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string", description: "What to tell the user now, 1-3 short sentences. Empty string if nothing new is worth saying." },
    important: { type: "boolean", description: "True only if the user should look right away: a question was just asked that they may need to answer, or a deadline, test or instruction was given." },
    tasks: {
      type: "array", maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: ["homework", "email", "unfinished", "other"] },
          due: { type: "string", description: "YYYY-MM-DD if a date or day was mentioned" },
          time: { type: "string", description: "24h HH:MM if a time was mentioned" },
        },
        required: ["title", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["say", "important", "tasks"],
  additionalProperties: false,
};

class Listener {
  /**
   * dir: where the engine lives. hooks: { emit(channel, data), runAI(opts) -> { done }, aiError(t), aiName(),
   * memories() -> text, today() -> text, onImportant(item), addTasks(items) }
   */
  constructor(dir, hooks) {
    this.dir = process.env.CLOAK_VOICE_DIR || dir;
    this.hooks = hooks;
    this.engine = null;
    this.ready = false;
    this.waiting = new Map(); // clip id -> resolve
    this.seq = 0;
    this.state = { status: "off", detail: "" };
    this.listening = false;
    this.transcript = [];
    this.manual = false; // started from the Listen widget (rather than by Listen mode)
    this.mode = false;   // Listen mode is the active mode // { t, text }
    this.feed = [];       // { t, kind: "say" | "ask", text, q?, important? }
    this.lastRespondAt = 0;
    this.wordsSinceRespond = 0;
    this.responding = false;
    this.answering = false;
    this.pendingQuestion = null;
    this.answered = new Set(); // questions already answered (normalized), so a repeat isn't answered twice
    this.auto = true;
  }

  installed() {
    return process.env.CLOAK_VOICE_FAKE === "1" || fs.existsSync(path.join(this.dir, "node_modules", "@huggingface", "transformers", "package.json"));
  }
  setState(status, detail = "") {
    this.state = { status, detail };
    this.hooks.emit("listen-state", this.status());
  }
  status() {
    return { ...this.state, installed: this.installed(), listening: this.listening, mode: this.mode, auto: this.auto, transcript: this.transcript.slice(-200), feed: this.feed.slice(-50) };
  }

  // One-time setup: npm installs the speech engine into its own folder. Resolves { ok } or { error }.
  install() {
    if (this.installing) return this.installing;
    fs.mkdirSync(this.dir, { recursive: true });
    const pkg = path.join(this.dir, "package.json");
    if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: "cloak-voice", private: true }));
    this.setState("installing", "Downloading the speech engine (one time, about 500 MB). This can take a few minutes.");
    this.installing = new Promise((resolve) => {
      let err = "";
      const p = spawn(`npm install ${ENGINE_PACKAGE} --no-audit --no-fund --loglevel=error`, { cwd: this.dir, shell: true, windowsHide: true });
      p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
      p.on("error", (e) => (err = e.message));
      p.on("close", (code) => {
        this.installing = null;
        if (code === 0 && this.installed()) { this.setState("off", "Speech engine installed."); resolve({ ok: true }); }
        else {
          const msg = /not recognized|command not found|ENOENT/i.test(err) ? "Couldn't run npm. Install Node.js from nodejs.org, then try again." : `Setup failed: ${err.trim().split("\n").pop() || `npm exited with code ${code}`}`;
          this.setState("error", msg);
          resolve({ error: msg });
        }
      });
    });
    return this.installing;
  }

  startEngine() {
    if (this.engine) return;
    this.ready = false;
    const env = { ...process.env, CLOAK_VOICE_DIR: this.dir };
    this.engine = utilityProcess.fork(path.join(__dirname, "voice-engine.mjs"), [], { env, serviceName: "Cloak speech engine" });
    this.engine.on("message", (m) => {
      if (m.type === "progress") this.setState("loading", m.text);
      else if (m.type === "ready") { this.ready = true; if (this.listening) this.setState("listening"); }
      else if (m.type === "text" || m.type === "error") {
        const done = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (m.type === "error" && !m.id) this.setState("error", `Speech engine: ${m.message}`);
        done?.(m.type === "text" ? { text: m.text } : { error: m.message });
      }
    });
    this.engine.on("exit", () => {
      this.engine = null;
      this.ready = false;
      for (const done of this.waiting.values()) done({ error: "The speech engine stopped." });
      this.waiting.clear();
      if (this.listening) this.setState("error", "The speech engine stopped. Press Start to try again.");
    });
    this.engine.postMessage({ type: "load" });
  }

  start() {
    if (!this.installed()) return { error: "Set up Listen first." };
    this.listening = true;
    this.startEngine();
    this.setState(this.ready ? "listening" : "loading", this.ready ? "" : "Starting the speech engine…");
    return { ok: true };
  }
  // keepEngine: Talk mode still needs the speech engine.
  stop(keepEngine = false) {
    this.listening = false;
    if (!keepEngine) {
      this.engine?.kill(); // frees its memory; it starts again next time
      this.engine = null;
    }
    this.setState("off");
  }

  // A clip from the panel: 16 kHz mono Float32Array. Adds what was said to the transcript.
  // keep: false for Talk mode (what you said goes to the chat, not into Listen's transcript).
  transcribe(pcm, { keep = true } = {}) {
    if (!this.engine) this.startEngine();
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.engine.postMessage({ type: "transcribe", id, pcm });
    }).then((r) => {
      if (r.error) return r;
      const text = (r.text || "").replace(/\s+/g, " ").trim();
      if (text && JUNK.test(text)) return { text: "" };
      if (text && keep) this.addTranscript(text);
      return { text };
    });
  }

  addTranscript(text) {
    const now = Date.now();
    this.transcript.push({ t: now, text });
    this.transcript = this.transcript.filter((s) => s.t > now - KEEP_MS);
    this.wordsSinceRespond += text.split(/\s+/).length;
    this.hooks.emit("listen-transcript", { t: now, text });
    if (!this.auto) return;
    // A question gets answered right away; everything else is looked at every so often.
    const q = lastQuestion(text);
    if (q) this.answer(q).catch(() => {});
    else if (this.wordsSinceRespond >= RESPOND_MIN_WORDS && now - this.lastRespondAt >= RESPOND_EVERY_MS) this.respond().catch(() => {});
  }

  // Answers a question that was just asked out loud, from general knowledge, memory and saved files.
  async answer(question) {
    const key = question.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (this.answered.has(key) || SMALL_TALK.test(question)) return null;
    if (this.answering) { this.pendingQuestion = question; return null; }
    this.answering = true;
    this.answered.add(key);
    try {
      const remembered = this.hooks.memories();
      let recalled = "";
      try { recalled = await this.hooks.recall?.(question) || ""; }
      catch { recalled = "Memory lookup failed. Check saved memory and don't guess missing personal details."; }
      const prompt = `A question was just asked out loud in what's playing on the user's computer (a class, meeting, call or video): "${question}"

Write the answer the user will read out loud, word for word, as their own words. It pops up on their screen while they're on the spot, so:
- Only the answer, phrased the way a person would say it: "Two." / "Paris." / "It makes the cell's energy, ATP, through cellular respiration."
- No "The answer is", no explanations, no reasoning, no hedging, no lists, no markdown, no quotation marks.
- As short as a natural spoken answer: a word or number when that's enough, at most two short sentences.
- It must be correct. Use what the user asked you to remember and their saved files when they're relevant (open a saved file when you need its details); if memory is insufficient, search normally for current/public facts when useful, but never invent a missing personal memory.
The question comes from speech recognition, so read past small mistakes. If it isn't really a question that needs an answer (rhetorical, small talk like "how are you", or too unclear), return an empty answer. Today is ${this.hooks.today()}.
${remembered ? `\nWhat the user asked you to remember about them:\n${remembered}\n` : ""}${recalled ? `\n${recalled}\n` : ""}
What was said just before, for context (oldest first):
"""
${this.recent(2, 2500)}
"""`;
      const res = await this.hooks.runAI({ prompt, jsonSchema: ANSWER_SCHEMA, effort: "low", readFiles: true, timeoutMs: 90_000 }).done;
      if (res.error) throw new Error(res.error);
      if (res.json.is_error) throw new Error(res.json.result);
      let out = res.json.structured_output;
      if (!out) { try { out = JSON.parse(res.json.result); } catch { out = { answer: res.json.result }; } }
      const text = String(out?.answer || "").replace(/[*_`#]/g, "").replace(/^["'“]+|["'”]+$/g, "").trim();
      if (!text) return null;
      const item = { t: Date.now(), kind: "answer", q: question, text, important: true };
      this.pushFeed(item);
      this.hooks.onImportant(item);
      return item;
    } catch (e) {
      this.pushFeed({ t: Date.now(), kind: "error", q: question, text: this.hooks.aiError(e.message) });
      return null;
    } finally {
      this.answering = false;
      const next = this.pendingQuestion;
      this.pendingQuestion = null;
      if (next) this.answer(next).catch(() => {});
    }
  }

  // The last few minutes as text, for prompts (and for the chat, while listening).
  recent(minutes = 5, maxChars = 4000) {
    const since = Date.now() - minutes * 60_000;
    const text = this.transcript.filter((s) => s.t >= since).map((s) => s.text).join(" ");
    return text.length > maxChars ? "…" + text.slice(-maxChars) : text;
  }

  // Asks the AI whether anything in the new speech is worth saying. Returns the feed item (or null).
  // One at a time: asking while one is already running gets that one's result.
  respond() {
    if (!this.transcript.length) return Promise.resolve(null);
    this.respondRun ||= this.respondOnce().finally(() => { this.respondRun = null; });
    return this.respondRun;
  }
  async respondOnce() {
    this.responding = true;
    const newWords = this.wordsSinceRespond;
    this.lastRespondAt = Date.now();
    this.wordsSinceRespond = 0;
    try {
      const said = this.feed.filter((f) => f.kind === "say").slice(-5).map((f) => `- ${f.text}`).join("\n");
      const remembered = this.hooks.memories();
      const prompt = `You're listening along with the user to audio playing on their computer: a class, meeting, call or video. Below is a live transcript from speech recognition (it can have mistakes). Today is ${this.hooks.today()}.

Decide if there's anything worth telling the user right now about the newest part (the last ${newWords} or so words). Questions are answered separately, so don't answer them here.
- a deadline, test, assignment or instruction was given: say it clearly, and add it to tasks (with a date if one was said)
- otherwise, only a genuinely important point. Don't summarize routine talk, and don't repeat what you already told them.
If nothing is worth saying, return an empty "say".
${remembered ? `\nWhat the user asked you to remember about them:\n${remembered}\n` : ""}${said ? `\nWhat you already told them:\n${said}\n` : ""}
Transcript (last few minutes, oldest first):
"""
${this.recent(5)}
"""`;
      const res = await this.hooks.runAI({ prompt, jsonSchema: LISTEN_SCHEMA, effort: "low", timeoutMs: 120_000 }).done;
      if (res.error) throw new Error(res.error);
      if (res.json.is_error) throw new Error(res.json.result);
      let out = res.json.structured_output;
      if (!out) { try { out = JSON.parse(res.json.result); } catch { out = null; } }
      const added = out?.tasks?.length ? this.hooks.addTasks(out.tasks) || [] : [];
      // A deadline it added to Tasks is always mentioned, even if it had nothing else to say.
      const say = String(out?.say || "").trim() || (added.length ? `Added to your Tasks: ${added.map((t) => t.title).join("; ")}.` : "");
      if (!say) return null;
      const item = { t: Date.now(), kind: "say", text: say, important: !!out.important };
      this.pushFeed(item);
      if (item.important) this.hooks.onImportant(item);
      return item;
    } catch (e) {
      this.pushFeed({ t: Date.now(), kind: "error", text: this.hooks.aiError(e.message) });
      return null;
    } finally {
      this.responding = false;
    }
  }

  // A question from the Listen panel about what was heard.
  async ask(question) {
    const q = String(question || "").trim();
    if (!q) return null;
    const remembered = this.hooks.memories();
    let recalled = "";
    try { recalled = await this.hooks.recall?.(q) || ""; }
    catch { recalled = "Memory lookup failed. Check saved memory and don't guess missing personal details."; }
    const prompt = `The user is listening to audio playing on their computer (a class, meeting, call or video), transcribed live below (speech recognition, may have mistakes). Answer their question about it briefly and directly. If the transcript doesn't cover it, check saved memory when relevant, then search normally for current/public facts if useful; do not invent missing personal details. Today is ${this.hooks.today()}.
${remembered ? `\nWhat the user asked you to remember about them:\n${remembered}\n` : ""}${recalled ? `\n${recalled}\n` : ""}
Transcript (oldest first):
"""
${this.recent(60, 12000) || "(nothing heard yet)"}
"""

Question: ${q}`;
    const res = await this.hooks.runAI({ prompt, effort: "low", timeoutMs: 120_000 }).done;
    const err = res.error || (res.json.is_error ? res.json.result : "");
    const item = err ? { t: Date.now(), kind: "error", q, text: this.hooks.aiError(err) } : { t: Date.now(), kind: "ask", q, text: String(res.json.result || "").trim() };
    this.pushFeed(item);
    return item;
  }

  pushFeed(item) {
    this.feed.push(item);
    this.feed = this.feed.slice(-200);
    this.hooks.emit("listen-feed", item);
  }
  clear() {
    this.transcript = [];
    this.feed = [];
    this.answered.clear();
    this.wordsSinceRespond = 0;
    this.hooks.emit("listen-state", this.status());
  }
}

module.exports = { Listener, LISTEN_SCHEMA, lastQuestion };
