// Things you've asked Cloak to remember ("my exam is on Friday", "I prefer short answers"). Claude (or ChatGPT)
// sees them with every chat message and every Listen response. You add them in Settings > Memory, or by telling
// the AI to remember something: it replies with a ```memory block, which Cloak removes from the reply and saves.
//
// Files (PDFs, notes, images) can be saved too: Cloak keeps its own copy, the AI writes a summary that goes with
// every message, and it opens the file itself when it needs the details.
// (Not to be confused with lib/memory.js, which is screen memory.)
const fs = require("fs");
const path = require("path");

const FILE_TYPES = /\.(pdf|txt|md|markdown|csv|json|html?|png|jpe?g|webp|gif)$/i;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const FILES_CONTEXT_CHARS = 4000;

const MAX = 200;           // how many are kept
const CONTEXT_CHARS = 4000; // how much goes to the AI with each message (newest first)

class MemoryStore {
  constructor(file, onChange = () => {}) {
    this.file = file;
    this.onChange = onChange;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    this.items = data.items || [];
    this.files = data.files || []; // { id, name, path, size, status: "reading" | "ready" | "error", summary, error, created }
    this.filesDir = path.join(path.dirname(file), "memory-files");
    // A summary that was still being written when Cloak closed gets another go.
    for (const f of this.files) if (f.status === "reading") f.status = "pending";
  }
  save() {
    fs.writeFileSync(this.file, JSON.stringify({ items: this.items, files: this.files }, null, 2));
    this.onChange(this.list(), this.files);
  }

  // Copies a file into Cloak's own folder (so it stays even if you move or delete the original).
  addFile(src) {
    const name = path.basename(src);
    if (!FILE_TYPES.test(name)) throw new Error(`${name}: Cloak can remember PDFs, text, Markdown, CSV, JSON, HTML and images.`);
    const size = fs.statSync(src).size;
    if (size > MAX_FILE_BYTES) throw new Error(`${name} is over 30 MB.`);
    fs.mkdirSync(this.filesDir, { recursive: true });
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dest = path.join(this.filesDir, `${id}-${name.replace(/[^\w.\- ]+/g, "_")}`);
    fs.copyFileSync(src, dest);
    const f = { id, name, path: dest, size, status: "reading", summary: "", created: Date.now() };
    this.files.unshift(f);
    this.save();
    return f;
  }
  setFile(id, patch) {
    const f = this.files.find((x) => x.id === id);
    if (!f) return;
    Object.assign(f, patch);
    this.save();
  }
  removeFile(id) {
    const f = this.files.find((x) => x.id === id);
    if (!f) return;
    this.files = this.files.filter((x) => x.id !== id);
    try { fs.rmSync(f.path, { force: true }); } catch {}
    this.save();
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
  clear() {
    for (const f of this.files) { try { fs.rmSync(f.path, { force: true }); } catch {} }
    this.items = []; this.files = []; this.save();
  }

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
    const files = [];
    size = 0;
    for (const f of this.files.filter((x) => x.status === "ready")) {
      const line = `- ${f.name} (${f.path}): ${f.summary}`;
      if (size + line.length > FILES_CONTEXT_CHARS) break;
      files.push(line);
      size += line.length + 1;
    }
    if (files.length) lines.push(`Files the user saved for you to know (summaries; read the file at its path when you need the details):\n${files.join("\n")}`);
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

module.exports = { MemoryStore, extractMemoryBlocks, FILE_TYPES };
