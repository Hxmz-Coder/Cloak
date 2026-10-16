# overclaude

A customizable Claude overlay for your Windows desktop. It adds a small widget at the top of your screen with a chat bar, a task list, notes, screen memory, and widgets that Claude builds for you.

It runs Claude through the [Claude Code](https://code.claude.com) CLI using **your own Claude subscription login** (Pro or Max). There's no API key and no separate billing.

**v1.0.0**

## Features

- **Top widget.** Choose an **Island** (text plus whatever you pick: your next task, task count, date, time, or a status from one of your widgets) or a minimal **Dot**. The text can be empty. It opens into the chat bar when you hover over it.
- **Fast chat.** Claude stays running in the background, and replies stream in word by word, usually starting within about a second. You'll see what it's doing ("Searching the web…"). Your conversation is still there after a restart.
- **Gets things done.** Claude works through multi-step requests on its own. Anything that changes your system (commands that modify things, file edits, opening web pages) shows an **Allow / Decline** card first. Tick "Always allow" to trust that kind of action from then on.
- **Shortcut buttons** in one scrollable row, such as *What did I just do?*, *Explain my screen* and *Answer this*. You can add your own; use `{clipboard}` in a prompt to insert copied text.
- **Screen memory.** *What did I just do?* recaps your last half hour, using the window history and screenshots kept on your PC.
- **Tasks** with due dates and times. Add them yourself, or let Claude add them from your notes, your chats, or your recent activity.
- **Notes.** A plain notepad that saves as you type. *Find tasks* turns the to-dos in it into tasks without changing your notes.
- **Custom widgets.** In Settings, go to Widgets, describe a widget, and Claude codes and installs it (a calendar, focus timer, habit tracker and so on). You can ask Claude to change it later, or undo a change. Every widget gets a button in the chat bar. When you have more than four, the rest go in a folder, and one button opens or hides all of them.
- **Settings.** Accent color, opacity, top-widget style, shortcut buttons, widgets, chat speed, privacy, keyboard shortcuts, and starting with Windows.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 18 or later
- Claude Code, installed and signed in with your Claude account:
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

If `claude` isn't on your PATH, set `CLAUDE_CLI_PATH` to its full path. The app removes `ANTHROPIC_API_KEY` and similar variables before running Claude, so it always uses your subscription.

## FAQ

**Can it see my claude.ai or Claude app chats?** No. overclaude signs in with your Claude account through Claude Code, but Claude Code can't read your claude.ai conversations, and no app can. overclaude keeps its own conversation, which is still there after a restart, and gives Claude your tasks, the time, and (when you ask) your screen and recent activity.

**Why is the first reply after starting a bit slower?** Claude starts up once in the background when overclaude launches. After that, replies begin streaming within about a second.

## Privacy and safety

- Screen memory, notes, tasks and chat history are stored only in `%APPDATA%\overclaude`. Claude sees them only when you ask for a recap or a task scan, or when a task scan runs automatically (you can turn that off in Settings).
- In chat, Claude can read files in your user folder and search the web without asking. Everything else needs your approval.
- Custom widgets run **sandboxed**: no Node.js, no network, and no file access. They only get a small API: their own storage, your tasks, read-only notes, asking Claude, and a status line for the top widget.

## Building widgets by hand

Claude-built widgets live in `%APPDATA%\overclaude\widgets\<id>\`. `source.json` holds the HTML, CSS and JS. The full widget API and its rules are documented in [`lib/widgets.js`](lib/widgets.js) (`API_DOC`).

## Project layout

| Path | What's there |
|---|---|
| `main.js` | Windows, hotkeys, chat, approvals, task scans, the widget builder |
| `lib/chat.js` | The always-running, streaming chat process |
| `lib/claude.js` | Runs the `claude` CLI and turns its errors into clear messages |
| `lib/permissions.js` | What runs without asking, and the approval cards |
| `lib/memory.js` | Screen memory (window history and screenshots) |
| `lib/tasks.js` | The task list |
| `lib/widgets.js` | The custom widget store, the builder prompt, and the sandboxed page template |
| `index.html` / `renderer.js` | The top widget and chat bar |
| `tasks.*`, `notes.*`, `settings.*` | The built-in panels |
| `theme.css` / `theme.js` / `panel.*` | Shared look, theme syncing, and the movable panel frame |
| `widget-preload.js` | The only API custom widgets get |

Set `OVERCLAUDE_DATA_DIR` to keep data in a different folder, for example for testing.
