// Task list shared by you and Claude. Claude adds tasks two ways:
//  - in chat, by including a ```tasks block in its reply (the widget strips it out and adds the lines)
//  - on its own, by scanning your notes and recent activity for homework, emails to answer, unfinished work
const fs = require("fs");

const CATEGORIES = ["homework", "email", "unfinished", "other"];

class TaskStore {
  constructor(file, onChange) {
    this.file = file;
    this.onChange = onChange;
    try { this.data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { this.data = {}; }
    this.data.tasks ||= [];
    this.data.dismissed ||= []; // titles of Claude's tasks you deleted, so it doesn't re-add them
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    this.onChange(this.list());
  }

  list() { return this.data.tasks; }
  open() { return this.data.tasks.filter((t) => !t.done); }

  // items: [{ title, category, note?, due? }]. due is "YYYY-MM-DD". Returns the tasks actually added.
  add(items, source) {
    const known = new Set([...this.data.tasks.map((t) => norm(t.title)), ...(source === "claude" ? this.data.dismissed : [])]);
    const added = [];
    for (const it of items) {
      const title = String(it.title || "").trim().slice(0, 200);
      if (!title || known.has(norm(title))) continue;
      known.add(norm(title));
      const task = {
        id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        title,
        category: CATEGORIES.includes(it.category) ? it.category : "other",
        note: it.note ? String(it.note).slice(0, 300) : undefined,
        due: validDate(it.due),
        source,
        done: false,
        created: Date.now(),
      };
      this.data.tasks.unshift(task);
      added.push(task);
    }
    if (added.length) this.save();
    return added;
  }

  update(id, patch) {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) return;
    const clean = {};
    if ("title" in patch && String(patch.title).trim()) clean.title = String(patch.title).trim().slice(0, 200);
    if ("category" in patch && CATEGORIES.includes(patch.category)) clean.category = patch.category;
    if ("due" in patch) clean.due = validDate(patch.due);
    if ("done" in patch) Object.assign(clean, { done: !!patch.done }, patch.done ? { doneAt: Date.now() } : {});
    Object.assign(t, clean);
    this.save();
  }

  remove(id) {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.source === "claude" && !t.done) this.data.dismissed = [...this.data.dismissed, norm(t.title)].slice(-300);
    this.data.tasks = this.data.tasks.filter((x) => x.id !== id);
    this.save();
  }

  clearDone() {
    this.data.tasks = this.data.tasks.filter((t) => !t.done);
    this.save();
  }

  // Short summary of open tasks for Claude's context.
  summary() {
    const open = this.open().slice(0, 30);
    return open.length ? open.map((t) => `- [${t.category}] ${t.title}${t.due ? ` (due ${t.due})` : ""}`).join("\n") : "(none)";
  }
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const validDate = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()) ? d.trim() : undefined);

// Pulls ```tasks blocks out of a chat reply. Lines look like "homework | Finish chem lab report | 2026-10-16"
// (the due date is optional).
function extractTaskBlocks(text) {
  const items = [];
  const cleaned = text.replace(/```tasks[^\n]*\n([\s\S]*?)```/g, (_, body) => {
    for (const raw of body.split("\n")) {
      const line = raw.replace(/^\s*[-*]\s*/, "").trim();
      if (!line) continue;
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 2 && /^\w+$/.test(parts[0])) items.push({ category: parts[0].toLowerCase(), title: parts[1], due: parts[2] });
      else items.push({ category: "other", title: line });
    }
    return "";
  });
  return { text: cleaned.trim(), items };
}

// Structured output for task scans. Notes can hold many to-dos, so they get a higher cap than activity scans.
function scanSchema(maxItems) {
  return {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        maxItems,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, actionable, e.g. 'Reply to Prof. Lee about the extension'" },
            category: { type: "string", enum: CATEGORIES },
            due: { type: "string", description: "Due date as YYYY-MM-DD, only if a date or day is mentioned or clearly implied" },
            note: { type: "string", description: "Where this came from (what you saw, or the note line)" },
          },
          required: ["title", "category"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  };
}

module.exports = { TaskStore, extractTaskBlocks, scanSchema, CATEGORIES };
