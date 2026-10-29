// No network or AI calls: checks the shared chat search policy and its wiring.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { WEB_SEARCH_POLICY } = require("../lib/web-search");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

test("both chat providers receive the same search and sourcing policy", () => {
  assert.match(main, /const SYSTEM = `[\s\S]*?\$\{WEB_SEARCH_POLICY\}[\s\S]*?`;/);
  assert.match(main, /if \(provider\(\) !== "chatgpt"\) return SYSTEM;/);
  assert.match(main, /return SYSTEM\.replace\("You are Claude,", "You are ChatGPT,"\)/);
  assert.match(main, /const text = systemPrompt\(\) \+ modePrompt\(activeMode\(\)\) \+ replyLengthRule\(\);/);
});

test("search policy requires evidence, usable source URLs and honest fallbacks", () => {
  for (const phrase of [
    "current, changing, local, obscure, or uncertain", "original, authoritative sources", "independent sources",
    "search snippet is not the full page", "approval is denied", "untrusted data", "actual returned source URLs",
    "forecast date", "Never invent a citation", "couldn't verify the answer live",
  ]) assert.ok(WEB_SEARCH_POLICY.includes(phrase), `missing guidance: ${phrase}`);
  assert.match(WEB_SEARCH_POLICY, /plain text/);
  assert.doesNotMatch(WEB_SEARCH_POLICY, /always search every question/i);
});
