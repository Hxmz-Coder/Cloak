# Cloak

A customizable Claude overlay for your Windows desktop. It adds a small widget at the top of your screen with a chat bar, a task list, notes, screen memory, and widgets that Claude builds for you.

It runs Claude through the [Claude Code](https://code.claude.com) CLI, using either **your Claude subscription** (Pro or Max, with no extra cost) or **your own Anthropic API key** (pay per use). A setup guide walks you through either one.

**v1.0.2**

## Features

- **Setup guide.** On first launch, a short guide asks what you'll use Cloak for, connects Claude step by step (it can run the official Claude Code installer, open sign-in, or take an API key), picks a starting mode, and tours the essentials. You can reopen it from Settings, General.
- **Modes.** Switch how Claude behaves for what you're doing: **General**, **Homework** (concepts, steps, checking your work), **Practice** (a hint first, then the solution, and it won't complete live graded quizzes or tests), **Writing** and **Coding**. Each mode has its own instructions and shortcut buttons. Switch from the chat bar, or by right-clicking the top widget. Edit any mode, write your own, or describe one and Claude creates it. Modes never change your privacy settings or what needs your approval.
- **Top widget.** Choose an **Island** (text plus whatever you pick: your next task, task count, date, time, or a status from one of your widgets) or a minimal **Dot**. The text can be empty. It always shows what you chose; the only things that replace it for a moment are chat activity, something due right now ("Now: Dentist"), and new tasks. It opens into the chat bar when you hover over it.
- **Fast chat.** Claude stays running in the background, and replies stream in word by word, usually starting within about a second. You'll see what it's doing ("Searching the web…"). Your conversation is still there after a restart.
- **Gets things done.** Claude works through multi-step requests on its own. Anything that changes your system (commands that modify things, file edits, opening web pages) shows an **Allow / Decline** card first. Tick "Always allow" to trust that kind of action from then on.
- **Shortcut buttons** in one scrollable row, such as *What did I just do?*, *Explain my screen* and *Answer this*. You can add your own; use `{clipboard}` in a prompt to insert copied text.
- **Screen memory.** *What did I just do?* recaps your last half hour, using the window history and screenshots kept on your PC.
- **Tasks** with due dates and times. Add them yourself, or let Claude add them from your notes, your chats, or your recent activity.
- **Notes.** A plain notepad that saves as you type. A few seconds after you stop typing, any to-dos in it are added to your Tasks automatically. Your notes never change.
- **Custom widgets.** In Settings, go to Widgets, describe a widget, and Claude codes and installs it (a calendar, focus timer, habit tracker and so on). You can ask Claude to change it later, or undo a change. Widgets (and Tasks and Notes) can be moved, and resized from any edge. Every widget gets a button in the chat bar. When you have more than four, the rest go in a folder, and one button opens or hides all of them.
- **Settings.** Accent color, opacity, top-widget style, modes, shortcut buttons, widgets, chat speed, privacy, sign-in method, keyboard shortcuts, and starting with Windows.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 18 or later
- A paid Claude plan (Pro or Max) **or** an Anthropic API key. The Claude Free plan doesn't include Claude Code.
- Claude Code. The setup guide installs it for you, or you can install it yourself:
  ```powershell
  irm https://claude.ai/install.ps1 | iex
  claude        # then type /login and choose your Claude account
  ```

## Run it

```powershell
git clone https://github.com/Hxmz-Coder/overclaude.git
cd overclaude
start.bat          # installs what it needs the first time, then starts
```

You can also run `npm install` and then `npm start`.

| Shortcut | What it does |
|---|---|
| `Ctrl+Shift+Space` | Show or hide everything (chat bar and your widgets) |
| `Ctrl+Shift+S` | Take a screenshot and ask about it |
| Right-click the top widget | Open Settings |

You can change both shortcuts in **Settings, Keyboard**.

If `claude` isn't on your PATH, set `CLAUDE_CLI_PATH` to its full path. With the subscription option, the app removes `ANTHROPIC_API_KEY` and similar variables before running Claude, so you're never billed by accident. With the API key option, your key is stored encrypted on your PC (Windows data protection) and is only passed to Claude Code.

## FAQ

**Can it see my claude.ai or Claude app chats?** No. Cloak signs in with your Claude account through Claude Code, but Claude Code can't read your claude.ai conversations, and no app can. Cloak keeps its own conversation, which is still there after a restart, and gives Claude your tasks, the time, and (when you ask) your screen and recent activity.

**Why is the first reply after starting a bit slower?** Claude starts up once in the background when Cloak launches. After that, replies begin streaming within about a second.

## Privacy and safety

- Screen memory, notes, tasks and chat history are stored only in `%APPDATA%\cloak`. Claude sees them only when you ask for a recap or a task scan, or when a task scan runs automatically (you can turn that off in Settings).
- In chat, Claude can read files in your user folder and search the web without asking. Everything else needs your approval.
- Custom widgets run **sandboxed**: no Node.js, no network, and no file access. They only get a small API: their own storage, your tasks, read-only notes, asking Claude, and a status line for the top widget.

## Building widgets by hand

Claude-built widgets live in `%APPDATA%\cloak\widgets\<id>\`. `source.json` holds the HTML, CSS and JS. The full widget API and its rules are documented in [`lib/widgets.js`](lib/widgets.js) (`API_DOC`).

## Project layout

| Path | What's there |
|---|---|
| `main.js` | Windows, hotkeys, chat, approvals, task scans, the widget builder |
| `lib/chat.js` | The always-running, streaming chat process |
| `lib/modes.js` | Built-in modes (instructions and shortcut buttons) and the mode builder |
| `lib/claude.js` | Runs the `claude` CLI and turns its errors into clear messages |
| `lib/permissions.js` | What runs without asking, and the approval cards |
| `lib/memory.js` | Screen memory (window history and screenshots) |
| `lib/tasks.js` | The task list |
| `lib/widgets.js` | The custom widget store, the builder prompt, and the sandboxed page template |
| `index.html` / `renderer.js` | The top widget and chat bar |
| `tasks.*`, `notes.*`, `settings.*`, `welcome.*` | The built-in panels and the setup guide |
| `theme.css` / `theme.js` / `panel.*` | Shared look, theme syncing, and the movable panel frame |
| `widget-preload.js` | The only API custom widgets get |

Set `CLOAK_DATA_DIR` to keep data in a different folder, for example for testing.

## Testing

`npm run test:new-user` starts Cloak several times as a brand-new user, each run with its own throwaway profile, and runs eight scenarios:

| Scenario | What it covers |
|---|---|
| `first-run` | The setup guide, the pill, the bar, Settings, panels and themes |
| `student` | Homework answers checked against known results, plus tasks from chat |
| `practice` | Hints first, and refusing live graded tests |
| `writer-coder` | Writing and Coding modes |
| `actions` | Reading versus approval-required actions |
| `notes` | Turning notes into tasks |
| `builders` | Creating a mode and a widget with Claude |
| `edge-cases` | Bad API keys, HTML in messages, long input, Stop, and New chat |

Every window and console error is recorded, and so is every answer Claude gives. Reports go to `tests/results/`. To run one scenario several times, use `npm run test:new-user -- student x3`.

These tests make real Claude requests, so they use some of your plan's usage.
