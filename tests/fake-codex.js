// A stand-in for OpenAI's Codex CLI, for tests (point CODEX_CLI_PATH at this file). It speaks the same
// `codex exec --json` events, remembers conversations for `exec resume`, and logs every call to
// FAKE_CODEX_LOG so tests can check the flags Cloak used. No network, no account needed.
//   FAKE_CODEX_LOGGED_OUT=1   behave as if not signed in
const fs = require("fs");
const path = require("path");
const os = require("os");

const args = process.argv.slice(2);
const dir = path.join(os.tmpdir(), "cloak-fake-codex");
fs.mkdirSync(dir, { recursive: true });
const log = (o) => { if (process.env.FAKE_CODEX_LOG) fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(o) + "\n"); };
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (args[0] === "login" && args[1] === "status") {
  if (process.env.FAKE_CODEX_LOGGED_OUT) { process.stdout.write("Not logged in\n"); process.exit(1); }
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}
if (args[0] !== "exec") { process.stderr.write("fake codex: unsupported command\n"); process.exit(2); }

let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  const resume = args[1] === "resume";
  const valueAfter = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const configs = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));
  const images = args.flatMap((a, i) => (args[i - 1] === "-i" ? [a] : []));
  const write = configs.includes('sandbox_mode="workspace-write"');
  // resume: the session id is the argument just before the final "-"
  const thread = resume ? args[args.length - 2] : `fake-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  log({ args, resume, thread, write, images, prompt: stdin.slice(-400) });

  if (process.env.FAKE_CODEX_LOGGED_OUT) {
    out({ type: "thread.started", thread_id: thread });
    out({ type: "turn.started" });
    out({ type: "turn.failed", error: { message: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses" } });
    return process.exit(1);
  }

  const memFile = path.join(dir, `${thread}.txt`);
  const memory = fs.existsSync(memFile) ? fs.readFileSync(memFile, "utf8") : "";
  if (!args.includes("--ephemeral")) fs.appendFileSync(memFile, stdin + "\n");
  const last = stdin.trim().split("\n").pop();
  let reply;
  const schemaFile = valueAfter("--output-schema");
  if (schemaFile) {
    const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
    const props = schema.properties || {};
    if (props.html) reply = JSON.stringify({ name: "Counter", description: "Counts clicks.", html: '<div class="c"><button class="btn" id="b">Count</button> <span id="n">0</span></div>', css: "#app .c { padding: 12px; }", js: 'let n = 0; document.getElementById("b").addEventListener("click", () => { document.getElementById("n").textContent = ++n; });', width: 300, height: 220 });
    else if (props.tasks) reply = JSON.stringify({ tasks: [{ title: "Buy poster board", category: "other", due: null, time: null, note: null }] });
    else if (props.instructions) reply = JSON.stringify({ name: "Interview prep", description: "Practice interviews.", instructions: "Ask one interview question at a time and give feedback.", shortcuts: [{ label: "Ask me a question", prompt: "Ask me an interview question.", screenshot: false }, { label: "Rate my answer", prompt: "Rate my last answer.", screenshot: false }, { label: "Tips", prompt: "Give me interview tips.", screenshot: false }] });
    else reply = "{}";
  } else if (/what word did i ask you to remember/i.test(stdin)) {
    const m = /remember the word (\w+)/i.exec(memory);
    reply = m ? `You asked me to remember "${m[1]}".` : "You didn't ask me to remember a word.";
  } else if (/create a file/i.test(stdin) && !write) {
    reply = "I can make that file once you allow it.\n\nAPPROVAL NEEDED: Create notes.txt in Documents";
  } else if (/create a file|approved/i.test(stdin) && write) {
    reply = "Created notes.txt in Documents.";
  } else if (/reply with just the word: ready/i.test(stdin)) {
    reply = "ready";
  } else {
    reply = `ChatGPT here. You said: ${last}${images.length ? ` (I can see ${images.length} image${images.length > 1 ? "s" : ""})` : ""}`;
  }

  out({ type: "thread.started", thread_id: thread });
  out({ type: "turn.started" });
  if (/list files/i.test(stdin)) {
    out({ type: "item.started", item: { id: "item_1", type: "command_execution", command: "dir", status: "in_progress" } });
    out({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "dir", status: "completed", exit_code: 0 } });
  }
  setTimeout(() => {
    out({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: reply } });
    out({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    process.exit(0);
  }, 150);
});
