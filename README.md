# Claude Overlay

A customizable Claude overlay for your Windows desktop. It adds a small widget at the top of your screen with a chat bar, a task list, notes, screen memory, and widgets that Claude builds for you.

It runs Claude through the [Claude Code](https://code.claude.com) CLI using **your own Claude subscription login** (Pro or Max). There's no API key and no separate billing.

## Features

- **Top widget.** It opens into a chat bar when you hover over it. You can choose what it shows (text, time, task count, next task) and where it sits.
- **Chat that gets things done.** Claude works through multi-step requests on its own. Anything that changes your system (commands that modify things, file edits, opening web pages) shows an **Allow / Decline** card first. Tick "Always allow" to trust that kind of action from then on.
- **Shortcut buttons** such as *Explain my screen*, *Answer this* and *Fix my writing*. You can add your own; use `{clipboard}` in a prompt to insert copied text.
- **Screen memory.** The *What did I just do?* button recaps your last half hour, using the window history and screenshots kept on your PC.
- **Tasks.** Add tasks yourself, or let Claude add them from your notes, your chats, or your recent activity. Due dates are supported.
- **Notes.** A plain notepad that saves as you type. *Find tasks* turns the to-dos in your notes into tasks without changing the notes.
- **Custom widgets.** In Settings, go to Widgets, describe a widget, and Claude codes and installs it (a calendar, focus timer, habit tracker and so on). You can ask Claude to change it later, or undo a change.
- **Settings.** Accent color, opacity, shortcut buttons, widgets, privacy, keyboard shortcuts, and starting with Windows.

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
npm install
npm start          # or double-click start.bat
```

| Shortcut | What it does |
|---|---|
| `Ctrl+Shift+Space` | Show or hide everything (chat bar and your widgets) |
| `Ctrl+Shift+S` | Take a screenshot and ask about it |
| Right-click the top widget | Open Settings |

You can change both shortcuts in **Settings, Keyboard**.

If `claude` isn't on your PATH, set `CLAUDE_CLI_PATH` to its full path. The app removes `ANTHROPIC_API_KEY` and similar variables before running Claude, so it always uses your subscription.

## Privacy and safety

- Screen memory, notes and tasks are stored only in `%APPDATA%\claude-overlay`. Claude sees them only when you ask for a recap or a task scan, or when a task scan runs automatically (you can turn that off in Settings).
- In chat, Claude can read files in your user folder and search the web without asking. Everything else needs your approval.
- Custom widgets run **sandboxed**: no Node.js, no network, and no file access. They only get a small API: their own storage, your tasks, read-only notes, and asking Claude.

## Building widgets by hand

Claude-built widgets live in `%APPDATA%\claude-overlay\widgets\<id>\`. `source.json` holds the HTML, CSS and JS. The full widget API and its rules are documented in [`lib/widgets.js`](lib/widgets.js) (`API_DOC`).

## Project layout

| Path | What's there |
|---|---|
| `main.js` | Windows, hotkeys, chat, approvals, task scans, the widget builder |
| `lib/claude.js` | Runs `claude -p` and turns its errors into clear messages |
| `lib/permissions.js` | What runs without asking, and the approval cards |
| `lib/memory.js` | Screen memory (window history and screenshots) |
| `lib/tasks.js` | The task list |
| `lib/widgets.js` | The custom widget store, the builder prompt, and the sandboxed page template |
| `index.html` / `renderer.js` | The top widget and chat bar |
| `tasks.*`, `notes.*`, `settings.*` | The built-in panels |
| `theme.css` / `theme.js` / `panel.*` | Shared look, theme syncing, and the movable panel frame |
| `widget-preload.js` | The only API custom widgets get |
