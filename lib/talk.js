// Talk: you speak, Claude answers out loud in a natural voice. Used by the Talk widget (Start/Stop) and Talk mode
// (always on while it's the active mode).
//
// The Talk panel (talk.js) records the microphone and sends what you said at each pause. Here it's turned into
// text (Whisper, shared with Listen), sent to Talk's own fast conversation with the AI, and the reply is spoken
// sentence by sentence as it's written (Kokoro, lib/tts-engine.mjs), so the answer starts within seconds.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { utilityProcess } = require("electron");

const PACKAGES = { "@huggingface/transformers": "4.3.1", "kokoro-js": "1.2.1" };
// Voices people can pick (Kokoro's best ones), shown in the widget.
const VOICES = [
  ["af_heart", "Heart (US)"], ["af_bella", "Bella (US)"], ["af_nicole", "Nicole (US)"], ["af_sarah", "Sarah (US)"], ["af_sky", "Sky (US)"],
  ["am_michael", "Michael (US)"], ["am_adam", "Adam (US)"], ["am_eric", "Eric (US)"], ["am_liam", "Liam (US)"],
  ["bf_emma", "Emma (UK)"], ["bf_isabella", "Isabella (UK)"], ["bm_george", "George (UK)"], ["bm_lewis", "Lewis (UK)"],
];
// Things Whisper tends to "hear" in background noise; never sent as something you said.
const PHANTOM = /^\W*(thank(s| you)( (so much|very much|for watching|for listening))?|bye|you|okay|ok|hmm+|uh+|um+|so|yeah|oh)\W*$/i;

// Sentences complete so far in streamed text: [complete sentences], rest.
function takeSentences(buf) {
  const out = [];
  const re = /[^.!?\n]*[.!?]+["')\]]*(\s+|$)|[^\n]+\n+/g;
  let m, last = 0;
  while ((m = re.exec(buf)) && m[0].length) {
    if (m.index + m[0].length === buf.length && !/\s$/.test(m[0])) break; // might still be growing ("3." of "3.5")
    out.push(m[0].trim());
    last = m.index + m[0].length;
  }
  return [out.filter((s) => /\w/.test(s)), buf.slice(last)];
}
// What's said out loud: no markdown or symbols read literally.
const speakable = (t) => String(t || "").replace(/```[\s\S]*?```/g, " ").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/[*_#`>|~]/g, "").replace(/^\s*[-•]\s*/gm, "").replace(/\s+/g, " ").trim();

class Talker {
  /** hooks: { emit(ch, data), voiceDir, listenInstalled(), transcribe(pcm) -> { text, error }, makeChat() -> chat session,
   *  context() -> text, aiError(t), config() -> { talkVoice } } */
  constructor(hooks) {
    this.hooks = hooks;
    this.dir = process.env.CLOAK_VOICE_DIR || hooks.voiceDir;
    this.engine = null;
    this.ready = false;
    this.waiting = new Map();
    this.seq = 0;
    this.manual = false; // started from the Talk widget
    this.mode = false;   // Talk mode is the active mode
    this.status = "off";
    this.detail = "";
    this.busy = false;
    this.turn = 0;
    this.history = []; // { who: "you" | "claude", text, t }
    this.chat = null;
    this.speakChain = Promise.resolve();
  }

  get active() { return this.manual || this.mode; }
  voiceInstalled() {
    return process.env.CLOAK_VOICE_FAKE === "1" || fs.existsSync(path.join(this.dir, "node_modules", "kokoro-js", "package.json"));
  }
  installed() { return this.hooks.listenInstalled() && this.voiceInstalled(); }
  state() {
    return { status: this.status, detail: this.detail, active: this.active, mode: this.mode, installed: this.installed(), naturalVoice: this.voiceInstalled(), listenInstalled: this.hooks.listenInstalled(),
      voice: this.hooks.config().talkVoice || "af_heart", voices: VOICES, history: this.history.slice(-40) };
  }
  setStatus(status, detail = "") { this.status = status; this.detail = detail; this.hooks.emit("talk-state", this.state()); }

  // One-time setup: the speech engine (shared with Listen) and the voice, into Cloak's voice folder.
  install() {
    if (this.installing) return this.installing;
    fs.mkdirSync(this.dir, { recursive: true });
    const pkgFile = path.join(this.dir, "package.json");
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")); } catch {}
    // One copy of the speech library for both (kokoro-js would otherwise bring an older second copy, ~450 MB more).
    pkg = { name: "cloak-voice", private: true, ...pkg, dependencies: { ...pkg.dependencies, ...PACKAGES }, overrides: { "kokoro-js": { "@huggingface/transformers": "$@huggingface/transformers" } } };
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    this.setStatus("installing", "Setting up Talk (one time): downloading the speech engine and the voice. This can take a few minutes.");
    this.installing = new Promise((resolve) => {
      let err = "";
      const p = spawn("npm install --no-audit --no-fund --loglevel=error", { cwd: this.dir, shell: true, windowsHide: true });
      p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
      p.on("error", (e) => (err = e.message));
      p.on("close", (code) => {
        this.installing = null;
        if (code === 0 && this.voiceInstalled()) { this.setStatus("off", "Talk is set up."); resolve({ ok: true }); }
        else {
          const msg = /not recognized|ENOENT/i.test(err) ? "Couldn't run npm. Install Node.js from nodejs.org, then try again." : `Setup failed: ${err.trim().split("\n").pop() || `npm exited with code ${code}`}`;
          this.setStatus("error", msg);
          resolve({ error: msg });
        }
      });
    });
    return this.installing;
  }

  // The voice runs in its own process; started when Talk turns on, stopped when it's off (frees its memory).
  startVoice() {
    if (this.engine || !this.voiceInstalled()) return;
    this.ready = false;
    this.engine = utilityProcess.fork(path.join(__dirname, "tts-engine.mjs"), [], { env: { ...process.env, CLOAK_VOICE_DIR: this.dir }, serviceName: "Cloak voice" });
    this.engine.on("message", (m) => {
      if (m.type === "progress") this.setStatus("loading", m.text);
      else if (m.type === "ready") { this.ready = true; if (this.status === "loading") this.setStatus(this.active ? "listening" : "off"); }
      else if (m.type === "audio" || m.type === "error") {
        const done = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        done?.(m.type === "audio" ? { pcm: m.pcm, rate: m.rate } : { error: m.message });
      }
    });
    this.engine.on("exit", () => {
      this.engine = null;
      this.ready = false;
      for (const done of this.waiting.values()) done({ error: "The voice stopped." });
      this.waiting.clear();
    });
    this.engine.postMessage({ type: "load" });
  }
  stopVoice() { this.engine?.kill(); this.engine = null; this.ready = false; }

  start() {
    if (!this.hooks.listenInstalled() && !this.voiceInstalled()) return { error: "Set up Talk first." };
    this.startVoice();
    if (!this.chat) this.chat = this.hooks.makeChat();
    this.chat.warm();
    this.setStatus(this.voiceInstalled() && !this.ready ? "loading" : "listening", this.voiceInstalled() && !this.ready ? "Getting the voice ready…" : "");
    return { ok: true };
  }
  stop() {
    this.interrupt();
    this.stopVoice();
    this.setStatus("off");
  }
  // Talk again from scratch (the AI forgets this conversation).
  reset() {
    this.interrupt();
    this.chat?.reset();
    this.history = [];
    this.setStatus(this.active ? "listening" : "off");
  }

  // Stops the current answer: no more of it is written or spoken.
  interrupt() {
    this.turn++;
    if (this.busy) this.chat?.stop();
    this.busy = false;
    this.hooks.emit("talk-stop-audio");
    if (this.active && this.status !== "loading") this.setStatus("listening");
  }

  // A clip from the microphone: what you said, if it's real speech.
  async heard(pcm) {
    if (!this.active || this.busy) return { skipped: true };
    const r = await this.hooks.transcribe(pcm);
    const text = (r.text || "").replace(/\s+/g, " ").trim();
    if (r.error || !text || PHANTOM.test(text) || text.split(" ").length < 2) return { text, skipped: true };
    this.respond(text).catch(() => {});
    return { text };
  }

  // Sends what you said to the AI and speaks the reply as it's written.
  async respond(text) {
    const turn = ++this.turn;
    this.busy = true;
    this.history.push({ who: "you", text, t: Date.now() });
    this.hooks.emit("talk-line", { who: "you", text });
    this.setStatus("thinking");
    if (!this.chat) this.chat = this.hooks.makeChat();
    let buf = "", full = "";
    const flush = (final) => {
      const [done, rest] = takeSentences(buf);
      buf = rest;
      done.forEach((s) => this.say(s, turn));
      if (final && buf.trim()) { this.say(buf.trim(), turn); buf = ""; }
    };
    const ctx = this.hooks.context();
    let recalled = "";
    try { recalled = await this.hooks.recall?.(text) || ""; }
    catch { recalled = "Memory lookup failed. Check available saved memory, and don't guess missing personal details."; }
    if (turn !== this.turn) return; // interrupted while recalling
    const res = await this.chat.send(`${ctx || recalled ? `[${[ctx, recalled].filter(Boolean).join("\n")}]\n\n` : ""}${text}`, {
      onEvent: (ev) => {
        if (turn !== this.turn || ev.type !== "text") return;
        buf += ev.text; full += ev.text; flush(false);
      },
    });
    if (turn !== this.turn) return; // interrupted
    this.busy = false;
    if (res.error || res.json?.is_error) {
      const msg = this.hooks.aiError(res.error || res.json.result);
      this.hooks.emit("talk-line", { who: "error", text: msg });
      return this.setStatus("listening");
    }
    const reply = (res.json?.result || full).trim();
    if (!full.trim()) { buf = reply; } // no streaming (e.g. ChatGPT): speak the whole reply now
    flush(true);
    this.history.push({ who: "claude", text: reply, t: Date.now() });
    this.hooks.emit("talk-line", { who: "claude", text: reply });
    this.setStatus("listening"); // the panel shows "Speaking" while the reply plays
  }

  // Speaks one sentence after the ones before it. Without the natural voice, the panel uses the system voice.
  say(sentence, turn) {
    const text = speakable(sentence);
    if (!text) return;
    if (!this.voiceInstalled()) { this.hooks.emit("talk-say", { text, turn }); return; }
    this.speakChain = this.speakChain.then(async () => {
      if (turn !== this.turn) return; // interrupted meanwhile
      const a = await this.synth(text);
      if (turn !== this.turn) return; // interrupted while this sentence was being made
      if (a.error) return this.hooks.emit("talk-say", { text, turn }); // fall back to the system voice for this one
      this.hooks.emit("talk-audio", { pcm: a.pcm, rate: a.rate, turn });
    }).catch(() => {});
  }
  synth(text) {
    this.startVoice();
    if (!this.engine) return Promise.resolve({ error: "no voice" });
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.engine.postMessage({ type: "speak", id, text, voice: this.hooks.config().talkVoice || "af_heart" });
    });
  }
}

module.exports = { Talker, VOICES, takeSentences, speakable };
