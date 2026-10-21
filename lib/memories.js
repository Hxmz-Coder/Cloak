// Things you've asked Cloak to remember ("my exam is on Friday", "I prefer short answers"). Claude (or ChatGPT)
// sees them with every chat message and every Listen response. You add them in Settings > Memory, or by telling
// the AI to remember something: it replies with a ```memory block, which Cloak removes from the reply and saves.
// (Not to be confused with lib/memory.js, which is screen memory.)
const fs = require("fs");

const MAX = 200;           // how many are kept
const CONTEXT_CHARS = 4000; // how much goes to the AI with each message (newest first)

class MemoryStore {
  constructor(file, onChange = () => {}) {
    this.file = file;
    this.onChange = onChange;
    try { this.items = JSON.parse(fs.readFileSync(file, "utf8")).items || []; } catch { this.items = []; }
  }
  save() {
    fs.writeFileSync(this.file, JSON.stringify({ items: this.items }, null, 2));
    this.onChange(this.list());
  }
  list() { return this.items; }

  // texts: one or more facts. Returns the ones actually added (exact repeats are skipped).
  add(texts, source = "me") {
    const known = new Set(this.items.map((m) => norm(m.text)));
    const added = [];
    for (const raw of [].concat(texts)) {
      const text = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (!text || known.has(norm(text))) continue;
      known.add(norm(text));
      const m = { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, source, created: Date.now() };
      this.items.unshift(m);
      added.push(m);
    }
    if (added.length) { this.items = this.items.slice(0, MAX); this.save(); }
    return added;
  }
  update(id, text) {
    const m = this.items.find((x) => x.id === id);
    const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (!m || !t) return;
    m.text = t;
    this.save();
  }
  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((m) => m.id !== id);
    if (this.items.length !== before) this.save();
  }
  clear() { this.items = []; this.save(); }

  // For the AI: newest first, as bullets, within a size budget.
  context() {
    const lines = [];
    let size = 0;
    for (const m of this.items) {
      const line = `- ${m.text}`;
      if (size + line.length > CONTEXT_CHARS) break;
      lines.push(line);
      size += line.length + 1;
    }
    return lines.join("\n");
  }
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

// Pulls ```memory blocks out of a reply: one fact per line.
function extractMemoryBlocks(text) {
  const facts = [];
  const cleaned = String(text || "").replace(/```memory[^\n]*\n([\s\S]*?)```/g, (_, body) => {
    for (const line of body.split("\n")) {
      const f = line.replace(/^\s*[-*]\s*/, "").trim();
      if (f) facts.push(f);
    }
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), facts };
}

module.exports = { MemoryStore, extractMemoryBlocks };
