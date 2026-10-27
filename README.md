# Cloak

A customizable Claude overlay for your Windows desktop. It adds a small widget at the top of your screen with a chat bar, a task list, notes, screen memory, and widgets that Claude builds for you.

It runs Claude through the [Claude Code](https://code.claude.com) CLI, using either **your Claude subscription** (Pro or Max, with no extra cost) or **your own Anthropic API key** (pay per use). A setup guide walks you through either one.

**ChatGPT instead (early).** In Settings, General, you can switch the AI to **ChatGPT**. Cloak then talks to ChatGPT through OpenAI's [Codex CLI](https://github.com/openai/codex), signed in with your ChatGPT account (Plus or Pro). Settings has Install and Sign in buttons for it. Everything works the same, with one difference: ChatGPT starts read-only, and asks for one **Allow** per request before it changes files or runs commands. Claude's cards ask about each action separately.

**v1.1.0**

## Features

- **Open it like any app.** After the first start, Cloak adds itself to the Start menu on Windows (press the Windows key and type *Cloak*), or to your Applications folder on a Mac (search *Cloak* in Spotlight). Settings, General can add a desktop shortcut too.
- **Setup guide.** On first launch, a short guide asks what you'll use Cloak for and connects Claude in two steps. It installs Claude Code for you, then **Sign in** opens your browser to sign in with your Claude account. Cloak ticks each step off by itself; there's nothing to type and no "check again". It also takes an API key instead. Then it picks a starting mode and tours the essentials. You can reopen it from Settings, General.
- **Modes.** Switch how Claude behaves for what you're doing: **General**, **Homework** (concepts, steps, checking your work), **Practice** (a hint first, then the solution, and it won't complete live graded quizzes or tests), **Writing** and **Coding**. Each mode has its own instructions and shortcut buttons. Switch from the chat bar, or by right-clicking the top widget. **Talk** mode keeps the Talk widget (below) listening the whole time it's on. Edit any mode, write your own, or describe one and Claude creates it. Modes never change your privacy settings or what needs your approval.
- **Top widget.** Choose an **Island** (text plus whatever you pick: your next task, task count, date, time, or a status from one of your widgets) or a minimal **Dot**. The text can be empty. It always shows exactly what you chose and nothing else. Anything that needs your attention pops up as a notification instead. It opens into the chat bar when you hover over it.
- **Fast chat.** Claude stays running in the background, and replies stream in word by word, usually starting within about a second. Answers are short by default (Settings, Claude & privacy, **Answer length**), because Cloak is for quick help. **Continue in Claude** under any answer copies it and opens a full Claude chat for more depth. In the chat box, the Up arrow brings back your last message. You'll see what it's doing ("Searching the web…"). Your conversation is still there after a restart.
- **Gets things done.** Claude works through multi-step requests on its own. Anything that changes your system (commands that modify things, file edits, opening web pages) shows an **Allow / Decline** card first. Tick "Always allow" to trust that kind of action from then on.
- **Shortcut buttons** in one scrollable row, such as *What did I just do?*, *Explain my screen* and *Answer this*. You can add your own; use `{clipboard}` in a prompt to insert copied text.
- **Screen memory.** *What did I just do?* recaps your last half hour, using the window history and screenshots kept on your PC.
- **Tasks** with due dates and times. The list stays simple: just each task's title, with a small dot when it's due soon or late. Hover a task for its details and buttons, and click **+** to add one. The **Done** tab shows what you've finished. Claude also adds tasks from your notes, your chats, Listen, or your recent activity.
- **Listen.** Turns whatever is playing on your computer (a class, a meeting, a call, a video) into text, right on your PC with Whisper, so the audio never leaves it. It listens to the computer's sound, not your microphone. Two ways to use it:
  - **The Listen widget:** press Start when you want it. It shows the transcript, answers questions it hears, points out deadlines (and adds them to your Tasks), and you can ask it anything about what was said.
  - **Listen mode:** switch to it from the mode menu and it listens the whole time the mode is on (even after a restart). Whenever a question is asked, the answer pops up at the top of your screen within seconds, written as exactly what you'd say ("What's one plus one?" pops up "Two."), with no explanations, so you can read it straight off. Answers use general knowledge, what you've asked it to remember, and your saved files.

  The first time, **Set up Listen** downloads the speech engine (about 500 MB) and the speech model (about 80 MB). While Listen is on, the chat knows what was just said too ("what did she just ask?").
- **Talk.** Talk to Claude out loud, like a phone call. Press Start in the Talk widget (or switch to Talk mode) and just speak. Claude answers in a natural voice, starting a few seconds after you stop: each sentence is spoken as soon as it's written. Click the circle to interrupt, pick from 13 voices, or start a new conversation. Everything runs on your PC: your voice is turned into text with Whisper and the voice is made with Kokoro, so no audio leaves it. The microphone needs clear speech before anything is sent, so background noise isn't mistaken for a question, and it's ignored while Claude is speaking. The first time, **Set up Talk** downloads the speech engine and the voice (about 850 MB, or 330 MB if Listen is already set up). Talk has its own quick conversation, separate from the chat bar.
- **Memory.** Tell the chat "remember that my exam is on Friday", or add things in **Settings, Memory**. You can also save files there, such as a syllabus PDF, notes or a photo of the board: drop them in or click Choose files. The AI reads each one and keeps a summary in mind, and opens the file again when it needs the details. (With ChatGPT, PDFs aren't supported yet.) The AI sees what it remembers in every chat and Listen response, even after you start a new chat. You can edit or forget anything there.
- **Notes.** A plain notepad that saves as you type. A few seconds after you stop typing, any to-dos in it are added to your Tasks automatically. Your notes never change.
- **Notifications.** Like an iPhone's Dynamic Island, the top widget grows into a card to get your attention, even when it's hidden. It never takes the keyboard from what you're typing. You get a heads-up an hour and 15 minutes before a task's time, a check-in after the time passes ("Did you finish it?" with **Yes, done** and **Not yet** buttons), a 9 AM summary of what's due today and overdue, a 6 PM heads-up for tomorrow, and a notice when Claude's answer is ready or it needs your OK. You also hear when Claude finds new tasks, when a widget finishes building, and when a widget has something happening now. Click a notification to go straight to where it came from. Turn each kind on or off, mute the chime, or pause everything for an hour in **Settings, Notifications** (or from the tray icon).
- **Calendar and Pomodoro** come built in: a month calendar for events and your tasks, with filters, and a focus timer with adjustable lengths, check-ins and daily totals.
- **On-task checks.** In Homework mode, or while a Pomodoro focus session runs, Cloak takes a screenshot every few minutes (every 3 by default) and asks Claude whether you're on task. If you've drifted (YouTube, games, social media), a notification nudges you back to what you should be doing. Each screenshot is deleted right after. Turn it off, or change how often, in **Settings, Claude & privacy**. Like any widget, you can ask Claude to change them, or delete them.
- **Custom widgets.** In Settings, go to Widgets, describe a widget, and Claude codes and installs it (a calendar, focus timer, habit tracker and so on). You can ask Claude to change it later, or undo a change. Claude can change the built-in **Tasks** and **Notes** too. Its version takes their place, and **Restore original** brings the built-in one back. Your tasks and notes stay as they are either way. Widgets (and Tasks and Notes) can be moved, and resized from any edge. Every widget gets a button in the chat bar. When you have more than four, the rest go in a folder, and one button opens or hides all of them.
- **Settings.** The icon (the Cloak logo in your accent color, the classic star, or your own picture), accent and background colors, opacity, top-widget style, modes, shortcut buttons, widgets, chat speed, privacy, sign-in method, keyboard shortcuts, and starting with Windows.

## Requirements

- Windows 10 or 11, or a Mac with macOS 13 or later ([early, see On a Mac](#on-a-mac-early))
- [Node.js](https://nodejs.org) 18 or later
- A paid Claude plan (Pro or Max) **or** an Anthropic API key. The Claude Free plan doesn't include Claude Code.
- Claude Code. The setup guide installs it for you, or you can install it yourself:
  ```powershell
  irm https://claude.ai/install.ps1 | iex
  claude        # then type /login and choose your Claude account
  ```

## Run it

**Without git (easiest, good for testers):**

1. Install [Node.js](https://nodejs.org) (the LTS version; click through the installer with the defaults).
2. Go to [github.com/Hxmz-Coder/Cloak](https://github.com/Hxmz-Coder/Cloak), click **Code**, then **Download ZIP**.
3. Right-click the ZIP, choose **Extract All**, and open the extracted folder.
4. Double-click **start.bat**. The first time takes a minute or two while it downloads what it needs. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
5. The setup guide opens. It installs Claude Code if needed and helps you sign in with your Claude account (Pro or Max) or an API key.

After that, double-click `start.bat` to open Cloak, or turn on **Settings, General, Start when I sign in to Windows**.

**With git:**

```powershell
git clone https://github.com/Hxmz-Coder/Cloak.git
cd Cloak
start.bat          # installs what it needs the first time, then starts
```

You can also run `npm install` and then `npm start`.

| Shortcut | What it does |
|---|---|
| `Ctrl+Shift+Space` | Show or hide everything (chat bar and your widgets) |
| `Ctrl+Shift+S` | Take a screenshot and ask about it |
| `Ctrl+Alt+L` | Turn Listen mode on or off |
| Right-click the top widget | Open Settings |

You can change these shortcuts in **Settings, Keyboard**. In the chat, the Up arrow brings back your last message.

If `claude` isn't on your PATH, set `CLAUDE_CLI_PATH` to its full path. With the subscription option, the app removes `ANTHROPIC_API_KEY` and similar variables before running Claude, so you're never billed by accident. With the API key option, your key is stored encrypted on your PC (Windows data protection) and is only passed to Claude Code.

## On a Mac (early)

Cloak was made on Windows. The Mac version is new and hasn't been tried much yet, so tell the person who sent it to you what works and what doesn't. [MAC-TESTING.md](MAC-TESTING.md) is a checklist of what to try.

**What you need:** macOS 13 (Ventura) or later, and a Claude Pro or Max plan (or an Anthropic API key).

**Set it up (about 10 minutes the first time):**

1. Install [Node.js](https://nodejs.org): download the **LTS** version for macOS, open it and click through the installer.
2. Go to [github.com/Hxmz-Coder/Cloak](https://github.com/Hxmz-Coder/Cloak), click **Code**, then **Download ZIP**. Open your Downloads folder and double-click the ZIP to unzip it. You can move the folder anywhere you like (for example into Documents).
3. In the folder, double-click **start.command**.
   - If your Mac says it "cannot be opened because it is from an unidentified developer" or "Apple could not verify" it: click **Done** (or OK), open **System Settings, Privacy & Security**, scroll down, and click **Open Anyway** next to start.command. (On older macOS you can instead right-click start.command, choose **Open**, then **Open**.)
   - A Terminal window opens. The first time, it downloads what Cloak needs, which takes a minute or two.
4. Cloak appears as a small pill at the top of your screen, and a round icon in the menu bar (top right). There's no Dock icon. The setup guide opens: click **Install Claude Code** (a Terminal window runs Anthropic's installer), then **Sign in** and follow the steps.

After that, double-click `start.command` whenever you want Cloak, or turn on **Settings, General, Start when I log in to my Mac**.

**Permissions macOS asks for.** Cloak works without them, but some features need them. Change them any time in **System Settings, Privacy & Security**. If you started Cloak with `start.command` they're listed under **Electron**; with `npm start` from Terminal, under **Terminal**. After turning one on, quit Cloak (menu bar icon, Quit) and start it again.

| Permission | What needs it |
|---|---|
| **Screen Recording** (on newer macOS, *Screen & System Audio Recording*) | Screenshots (`Cmd+Shift+S`, *Explain my screen*) and screen memory. Without it, Cloak only sees your wallpaper. |
| **Accessibility** | Screen memory's window titles (which tab or document you were in). Without it, it only records the app's name. |
| **Automation, System Events** | Screen memory asks once to see which app is in front. Click **OK**. |
| **Microphone** | Listen (see below). Cloak never records your microphone; this is how macOS lets it hear BlackHole. |

**Listen on a Mac** needs one extra free tool, because the Electron version Cloak uses can't hear a Mac's sound by itself:

1. Install [BlackHole 2ch](https://existential.audio/blackhole/) (free; it's a virtual sound cable).
2. Open **Audio MIDI Setup** (in Applications, Utilities). Click **+** at the bottom left, choose **Create Multi-Output Device**, and tick both your speakers (or headphones) and **BlackHole 2ch**.
3. In **System Settings, Sound, Output**, choose that **Multi-Output Device**. You still hear everything, and Cloak hears it too. (Switch back to your speakers when you don't need Listen. macOS can't change the volume of a Multi-Output Device, so set the volume first.)
4. In Cloak, open Listen and press **Start listening**. Allow the microphone prompt.

**Keyboard shortcuts on a Mac:** `Cmd+Shift+Space` shows or hides everything and `Cmd+Shift+S` asks about your screen. You can change them in **Settings, Keyboard**.

**Your data** lives in `~/Library/Application Support/cloak` (in Finder: Go, Go to Folder, and paste that).

**Something went wrong?** Quit Cloak, open Terminal, and run it from there so you can see what it says:

```bash
cd ~/Downloads/Cloak-main    # or wherever the folder is: type "cd ", drag the folder into Terminal, press Return
npm install
npm start
```

Copy what Terminal prints and send it along with a screenshot.

## FAQ

**Can it see my claude.ai or Claude app chats?** No. Cloak signs in with your Claude account through Claude Code, but Claude Code can't read your claude.ai conversations, and no app can. Cloak keeps its own conversation, which is still there after a restart, and gives Claude your tasks, the time, and (when you ask) your screen and recent activity.

**Why is the first reply after starting a bit slower?** Claude starts up once in the background when Cloak launches. After that, replies begin streaming within about a second.

## Privacy and safety

- Screen memory, notes, tasks and chat history are stored only in `%APPDATA%\cloak`. Claude sees them only when you ask for a recap or a task scan, or when a task scan runs automatically (you can turn that off in Settings).
- In chat, Claude can read files in your user folder and search the web without asking. Everything else needs your approval.
- Custom widgets run **sandboxed**: no Node.js, no network, and no file access. They only get a small API: their own storage, your tasks, read-only notes, asking Claude, and a status line and alerts for the top widget. Only Claude's version of your Notes widget can change your notes.

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
| `lib/terminal.js`, `lib/platform.js` | Opening a terminal for installers and sign-in (PowerShell or Terminal.app), and finding programs on a Mac |
| `lib/codex.js` | ChatGPT through the Codex CLI: one-off runs, the chat, sign-in status and approval requests |
| `lib/tasks.js` | The task list |
| `lib/memories.js` | What you've asked the AI to remember |
| `lib/talk.js`, `lib/tts-engine.mjs`, `talk.js` | Talk: setup, the conversation, sentence-by-sentence speech (Kokoro); `talk.js` records the microphone and plays the voice |
| `audio-clips.js` | Cuts live sound into clips of speech, for Listen and Talk |
| `lib/listen.js`, `lib/voice-engine.mjs`, `listen.js` | Listen: setup, local speech-to-text (Whisper), the transcript and the AI's responses; `listen.js` captures the computer's sound |
| `lib/notify.js` | When to notify you (deadlines, check-ins, daily summary), remembered across restarts |
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

## Tests

`npm run test:new-user` runs every scenario, each in a fresh throwaway profile; your own data is never touched. Most scenarios make real Claude calls on your account. The test windows open off-screen and never take focus, so you can keep working while they run. Set `CLOAK_TEST_VISIBLE=1` to watch them instead.

To check how the top widget and Settings look without starting the app, run `node tests/preview/serve.js` and open http://localhost:4173. You can send each kind of notification from there.
