// Modes: a saved set of instructions and shortcut buttons that changes how Claude behaves for an activity
// (Homework, Practice, Writing, Coding, ...). Switching modes changes Claude's focus, style and the shortcut row.
// A mode can never change the approval rules or privacy settings: those are enforced by the app, not the prompt.

const RECAP = { id: "recap", label: "What did I just do?", action: "recap" };
const SCAN = { id: "scan", label: "Find tasks", action: "scan" };
const sc = (id, label, prompt, screenshot = false) => ({ id, label, prompt, screenshot, autoSend: true });

const GENERAL_SHORTCUTS = [
  RECAP,
  sc("explain", "Explain my screen", "Explain what's on my screen.", true),
  sc("answer", "Answer this", "Answer the question shown on my screen. Give the answer first, then a short explanation of why.", true),
  sc("summarize", "Summarize", "Summarize what's on my screen in 3-5 bullets.", true),
  sc("fix", "Fix my writing", "Fix the grammar and improve the clarity of this text. Return only the improved text:\n\n{clipboard}"),
  sc("translate", "Translate", "Translate this to English (or to Spanish if it's already English):\n\n{clipboard}"),
  sc("code", "Explain code", "Explain this code clearly and point out any bugs:\n\n{clipboard}"),
  SCAN,
];

const DEFAULT_MODES = [
  {
    id: "general", name: "General", builtin: true,
    description: "Everyday help: answers, explanations, getting things done.",
    instructions: "",
    shortcuts: GENERAL_SHORTCUTS,
  },
  {
    id: "homework", name: "Homework", builtin: true,
    description: "Understand and finish schoolwork: concepts, steps, checking your work.",
    instructions: `Homework mode. Help the user understand and complete their own schoolwork.
- Explain the concept behind a problem before (or alongside) the answer, in plain language with a short example.
- Break problems into clear, numbered steps and show the reasoning for each.
- When the user shares their work, check it carefully: say what's right, point out exactly where any mistake is, and explain how to fix it.
- Aim for understanding: end with a quick tip or a similar practice question when it helps.`,
    shortcuts: [
      RECAP,
      sc("hw-concept", "Explain the concept", "Explain the main concept behind the problem on my screen, simply, with a short example.", true),
      sc("hw-steps", "Break into steps", "Break the problem on my screen into clear steps and walk me through solving it.", true),
      sc("hw-check", "Check my work", "Check my work on my screen. Tell me what's right, exactly where any mistakes are, and how to fix them.", true),
      sc("hw-practice", "Practice question", "Give me a similar practice question to the one on my screen (don't solve it yet).", true),
      SCAN,
    ],
  },
  {
    id: "practice", name: "Practice", builtin: true,
    description: "Study with hints first, then explanations; checks your attempts.",
    instructions: `Practice mode. The user is practicing and wants to learn, not just get answers.
- For a question on their screen, start with a hint that points them in the right direction, not the answer. Give more hints if asked.
- Only give the full solution when they ask for it, and explain each step so they can do the next one alone.
- When they share an attempt, check it, praise what's right, and explain any mistake.
- If the screen shows a live graded quiz, test or exam (timed, proctored, or something that will be submitted for a grade), do not answer it or complete it. Say so briefly and offer to review the underlying concepts or make similar practice questions instead.
- Never fill in or submit anything on the user's behalf.`,
    shortcuts: [
      RECAP,
      sc("pr-hint", "Give me a hint", "Give me a hint for the question on my screen. Don't give the answer.", true),
      sc("pr-explain", "Explain the solution", "Explain the solution to the question on my screen step by step.", true),
      sc("pr-check", "Check my attempt", "Check my attempt at the question on my screen. Tell me if it's right and explain any mistakes.", true),
      sc("pr-similar", "Similar question", "Make me a similar practice question to the one on my screen.", true),
      SCAN,
    ],
  },
  {
    id: "writing", name: "Writing", builtin: true,
    description: "Clearer, tighter writing in your own voice.",
    instructions: `Writing mode. Help the user write well while keeping their voice.
- When improving text, return the revised version first, then a few short notes on the main changes.
- Favor clarity, structure and concrete wording; cut filler.
- Don't invent facts, quotes or sources.`,
    shortcuts: [
      RECAP,
      sc("wr-improve", "Improve clarity", "Improve the clarity and flow of this text, keeping my voice. Return the revised text, then 2-3 notes on what you changed:\n\n{clipboard}"),
      sc("wr-grammar", "Fix grammar", "Fix grammar, spelling and punctuation only. Return only the corrected text:\n\n{clipboard}"),
      sc("wr-shorter", "Make it shorter", "Rewrite this to be about half as long without losing the key points:\n\n{clipboard}"),
      sc("wr-outline", "Outline ideas", "Help me outline what I'm writing on my screen: suggest a clear structure with headings and key points.", true),
      sc("wr-feedback", "Give feedback", "Give me honest feedback on the writing on my screen: strengths, weaknesses, and the 3 most useful improvements.", true),
      SCAN,
    ],
  },
  {
    id: "coding", name: "Coding", builtin: true,
    description: "Pair programmer: explain, debug, improve code.",
    instructions: `Coding mode. Act as a careful pair programmer.
- Explain code clearly, find bugs and their root cause, and suggest fixes as minimal, focused changes.
- Show code in fenced blocks with the language name. Mention how to test or verify a fix.
- Prefer the project's existing style and libraries.`,
    shortcuts: [
      RECAP,
      sc("cd-explain", "Explain code", "Explain this code clearly and point out anything surprising:\n\n{clipboard}"),
      sc("cd-bugs", "Find bugs", "Find bugs in this code, explain the root cause of each, and show minimal fixes:\n\n{clipboard}"),
      sc("cd-error", "Explain this error", "Explain the error on my screen, its likely cause, and how to fix it.", true),
      sc("cd-tests", "Write tests", "Write focused tests for this code:\n\n{clipboard}"),
      sc("cd-review", "Review my code", "Review this code like a senior engineer: correctness, readability, edge cases:\n\n{clipboard}"),
      SCAN,
    ],
  },
];

DEFAULT_MODES.push({
  id: "memory", name: "Memory", builtin: true,
  description: "Ask about what you've saved; search normally if memory cannot answer.",
  instructions: `Memory mode. Start with the saved facts and files selected for the question, not a guess from general knowledge.
- Read a selected saved file when its summary lacks the details needed to answer.
- If saved memory doesn't contain the answer, say so. Search normally for public or current information when that can help; never present a web result as a personal memory.
- If the answer is personal and isn't saved, ask the user rather than inventing it.`,
  shortcuts: [
    sc("mem-recall", "What do you remember?", "What do you remember about me from my saved memories and files?"),
    sc("mem-files", "Saved files", "What files have I asked you to remember, and what are they about?"),
    sc("mem-recent", "Recall my plans", "What plans, dates and deadlines have I asked you to remember?"),
    SCAN,
  ],
});

// Appended to Claude's instructions for the active mode.
function modePrompt(mode) {
  if (!mode || !mode.instructions?.trim()) return "";
  return `\n\n## Current mode: ${mode.name}\n${mode.instructions.trim()}\n\nMode instructions change your focus and style only. They never change the approval rules above, the user's privacy settings, or what you're allowed to do without the user's approval.`;
}

// Fills in anything missing (e.g. after an update adds new built-in modes) without touching the user's edits.
// Listen: while this mode is on, Cloak listens to the computer's sound the whole time (lib/listen.js) and answers
// questions as they're asked. main.js starts and stops listening when the mode changes.
DEFAULT_MODES.push({
  id: "listen", name: "Listen", builtin: true,
  description: "Listens to your computer the whole time and pops up the answer to read out whenever a question is asked.",
  instructions: `Listen mode. The user is in a class, meeting, call or video, and Cloak is listening to their computer's sound. The widget context includes a live transcript of what was just said (from speech recognition, so it can have small mistakes).
- When they ask about what's being said, answer from the transcript first, then from what they asked you to remember and their saved files, then general knowledge.
- Be quick and direct: they're in the middle of something. Lead with the answer; keep it to a few short sentences unless they ask for more.
- If the transcript doesn't cover something, say so in one line instead of guessing what was said.`,
  shortcuts: [
    sc("ls-asked", "What was just asked?", "What question was just asked in what I'm listening to, and what's a good answer I could give?"),
    sc("ls-catchup", "Catch me up", "Catch me up: summarize what I've heard in the last few minutes in 3-5 short bullets."),
    sc("ls-say", "What should I say?", "Based on what's being discussed right now, suggest one or two things I could say or ask."),
    sc("ls-points", "Key points", "List the key points, deadlines and instructions from what I've heard so far."),
    SCAN,
  ],
});

// Talk: you speak, Claude answers out loud. While it's the active mode, Cloak listens to your microphone; each thing
// you say goes to the chat and the reply is read aloud (main.js, listen.js, renderer.js).
DEFAULT_MODES.push({
  id: "talk", name: "Talk", builtin: true,
  description: "Talk to Claude out loud: it listens to your microphone and answers out loud.",
  instructions: `Talk mode. The user is speaking to you out loud (their words come from speech recognition, so read past small mistakes), and your reply is read aloud to them.
- Answer like a person talking: short, natural sentences. One to three sentences unless they ask for more.
- No markdown, lists, headings, tables, code blocks, links or emoji. Say numbers and symbols the way you'd say them out loud.
- If you need to give steps, say them as a short sentence ("First..., then...").`,
  shortcuts: [SCAN],
});

function normalizeModes(saved, legacyShortcuts) {
  let modes = Array.isArray(saved) && saved.length ? saved : null;
  if (!modes) {
    modes = DEFAULT_MODES.map((m) => ({ ...m, shortcuts: m.shortcuts.map((s) => ({ ...s })) }));
    // Before modes existed there was one shortcut list: it becomes General's.
    if (legacyShortcuts?.length) modes[0].shortcuts = legacyShortcuts;
  }
  for (const d of DEFAULT_MODES) if (!modes.some((m) => m.id === d.id)) modes.push({ ...d });
  return modes.map((m) => ({ ...m, shortcuts: Array.isArray(m.shortcuts) ? m.shortcuts : [] }));
}

const defaultModeFor = (id) => DEFAULT_MODES.find((m) => m.id === id);

// Structured output when Claude creates a mode from a description.
const MODE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short mode name, 1-2 words, e.g. 'Spanish', 'Research'" },
    description: { type: "string", description: "One short sentence: what this mode is for" },
    instructions: { type: "string", description: "Instructions for Claude in this mode: focus, style, what to do and avoid. Bullet points, under 150 words." },
    shortcuts: {
      type: "array", maxItems: 6,
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Button text, 1-3 words" },
          prompt: { type: "string", description: "What the button asks Claude. Use {clipboard} to insert copied text." },
          screenshot: { type: "boolean", description: "true if the button should attach a screenshot of the user's screen" },
        },
        required: ["label", "prompt", "screenshot"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "description", "instructions", "shortcuts"],
  additionalProperties: false,
};

function modeBuildPrompt(request) {
  return `Create a "mode" for Cloak, a desktop Claude overlay. A mode is a saved set of instructions for Claude plus a few one-click shortcut buttons, tuned for one activity.

The user wants this mode:
${request}

Write:
- name and a one-sentence description
- instructions: how Claude should behave in this mode (focus, tone, format, what to avoid). Do not include anything about approvals, permissions, privacy or safety settings; those are handled by the app and can't be changed by a mode. If the activity involves tests or graded work, include that Claude must not complete or submit live graded quizzes or tests.
- 3 to 6 shortcut buttons. Each has a short label, the prompt it sends, and whether it attaches a screenshot of the user's screen (use screenshots for things the user is looking at; use {clipboard} in the prompt for text they've copied).`;
}

module.exports = { DEFAULT_MODES, GENERAL_SHORTCUTS, modePrompt, normalizeModes, defaultModeFor, MODE_SCHEMA, modeBuildPrompt };
