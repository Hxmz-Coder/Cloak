// On-task checks: while you're in Homework mode or a Pomodoro focus session is running, Cloak looks at your screen
// every few minutes and asks the AI whether you're on task. If not, a notification nudges you back.
// The screenshot is used for that one question and deleted right after. Off in Settings > Claude & privacy.
const fs = require("fs");
const path = require("path");

const DEFAULTS = { enabled: true, everyMin: 3 };
const SCHEMA = {
  type: "object",
  properties: {
    onTask: { type: "boolean", description: "True if what's on screen fits what they should be doing" },
    doing: { type: "string", description: "What's on the screen, in a few words (e.g. 'YouTube Shorts', 'Google Docs essay')" },
    nudge: { type: "string", description: "If off task: one short, friendly line to get them back, naming what they should be doing. Empty if on task." },
  },
  required: ["onTask", "doing", "nudge"],
  additionalProperties: false,
};

class FocusChecker {
  /** hooks: { config() -> { enabled, everyMin }, why() -> text or null (null = no check needed now), screenshot() -> png Buffer or null,
   *  dir, runAI(opts) -> { done }, notify(n) } */
  constructor(hooks) {
    this.hooks = hooks;
    this.sessions = new Map(); // widget id -> focus session running until (a ping must arrive before then)
    this.lastCheck = 0;
    this.running = false;
    this.offStreak = 0;
    this.timer = setInterval(() => this.tick().catch(() => {}), 20_000);
  }
  // A widget (the Pomodoro) says a focus session is running, or not. It pings while it runs.
  session(widgetId, on) {
    if (on) this.sessions.set(widgetId, Date.now() + 90_000); else this.sessions.delete(widgetId);
  }
  focusSessionRunning() {
    const now = Date.now();
    for (const [id, until] of this.sessions) if (until < now) this.sessions.delete(id);
    return this.sessions.size > 0;
  }
  async tick() {
    const cfg = { ...DEFAULTS, ...this.hooks.config() };
    const why = this.hooks.why(this.focusSessionRunning());
    if (!cfg.enabled || !why) { this.offStreak = 0; return; }
    if (this.running || Date.now() - this.lastCheck < cfg.everyMin * 60_000) return;
    this.running = true;
    this.lastCheck = Date.now();
    const shot = path.join(this.hooks.dir, `focus-check-${Date.now()}.png`);
    try {
      const png = await this.hooks.screenshot();
      if (!png) return;
      fs.writeFileSync(shot, png);
      const prompt = `The user should be focused right now: ${why}. Look at the screenshot of their screen and decide whether they're on task.
On task: schoolwork or work materials, documents, notes, research, coding, learning sites, email or messages clearly about their work, and Cloak itself.
Off task: social media, games, entertainment or unrelated videos, shopping, unrelated chatting. If it's ambiguous, say on task.
The screenshot: ./${path.basename(shot)} (open it with the Read tool).`;
      const res = await this.hooks.runAI({ prompt, jsonSchema: SCHEMA, cwd: this.hooks.dir, tools: "Read", allowedTools: ["Read"], effort: "low", model: "haiku", timeoutMs: 90_000 }).done;
      let out = res.json?.structured_output;
      if (!out && res.json?.result) { try { out = JSON.parse(res.json.result); } catch {} }
      if (!out) return;
      if (out.onTask) { this.offStreak = 0; return; }
      this.offStreak++;
      this.hooks.notify({
        kind: "focus", urgent: this.offStreak > 1,
        title: this.offStreak > 1 ? "Still off task" : "Back to it?",
        body: String(out.nudge || `You're on ${out.doing}.`).slice(0, 160),
      });
    } finally {
      this.running = false;
      fs.rm(shot, { force: true }, () => {});
    }
  }
}

module.exports = { FocusChecker, FOCUS_DEFAULTS: DEFAULTS };
