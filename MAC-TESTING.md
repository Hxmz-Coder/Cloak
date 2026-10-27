# Testing Cloak on a Mac

Cloak was built on Windows and the Mac version hasn't been run on a Mac yet. Thanks for trying it! Follow **On a Mac** in the [README](README.md) to set it up, then go through this list. For each step, note **works**, **doesn't work** (what happened instead), or **skipped**. Screenshots help a lot.

Before you start, write down: your Mac model (Apple silicon M1/M2/... or Intel), your macOS version (Apple menu, About This Mac), and your Node.js version (in Terminal: `node -v`).

## 1. Starting

- [ ] Double-click `start.command`. Did macOS block it? What did you click to get past it?
- [ ] The first run installs things in Terminal. Did it finish without red errors? Did Cloak open?
- [ ] Is there a small pill at the top center of the screen (under the menu bar, not hidden behind the notch)?
- [ ] Is there a round icon in the menu bar (top right)? Is it black/white like other menu bar icons, not orange? Does clicking it open a menu?
- [ ] Is there **no** Cloak/Electron icon in the Dock?
- [ ] Close the Terminal window. Does Cloak keep running?

## 2. Setup guide and Claude

- [ ] The setup guide opened by itself. Can you click and type in it?
- [ ] **Install Claude Code**: does a Terminal window open and run the installer? Then **Check again**: does it find Claude Code?
- [ ] **Sign in**: does a Terminal window open with the steps and Claude running? Can you finish `/login`?
- [ ] **Test**: does it say Claude answered?

## 3. Everyday use

- [ ] Hover the pill: does the chat bar open? Type "hi": does an answer stream in?
- [ ] Press `Cmd+Shift+Space`: does everything hide and show again?
- [ ] Open Tasks and Notes (menu bar icon). Can you move them, resize them, and type in them?
- [ ] Open a full-screen app (for example Safari in full screen). Is the pill still visible on top?
- [ ] Settings, Keyboard: click a shortcut and press `Cmd+Option+K`. Does it show "Cmd+Option+K"? Does the new shortcut work? (Set it back after.)
- [ ] Settings, General: turn on **Start when I log in to my Mac**. Log out and back in. Does Cloak start? (A "Background item added" notice from macOS is expected.) Turn it off and check it stays off next login.
- [ ] Do notifications appear at the top (for example, add a task due in 2 minutes)? Do you hear the chime?

## 4. Screenshots and screen memory

- [ ] Press `Cmd+Shift+S` or use **Explain my screen**. Did macOS ask for Screen Recording permission? After allowing it (and restarting Cloak), does Claude describe what's actually on your screen, not just your wallpaper?
- [ ] Make sure screen memory is on (menu bar icon). Did macOS ask to let Electron control **System Events**? Use a few apps for 5 minutes, then ask "What did I just do?". Does it name the apps? The window titles (only after allowing Accessibility for Electron)?

## 5. Listen

- [ ] Open Listen without BlackHole installed and press **Start listening**. Do you get a clear message about BlackHole (not a silent failure)?
- [ ] **Set up Listen** (downloads about 500 MB). Did it finish?
- [ ] Install BlackHole 2ch and set up the Multi-Output Device as the README says. Play a YouTube video with someone talking and press **Start listening**. Did macOS ask for the microphone? Do words appear in the Transcript tab within a few seconds?
- [ ] Ask a question out loud in the video (or play one, like a quiz video). Does an answer pop up?

## 6. ChatGPT (only if you have ChatGPT Plus)

- [ ] Settings, General: switch the AI to ChatGPT, click **Install** (Terminal opens), then **Sign in**. Does a chat with ChatGPT work?

## What to send back

- This list with your notes.
- Anything Terminal printed if something failed. The easiest way to see errors: quit Cloak (menu bar icon, Quit), then in Terminal run `npm start` inside the Cloak folder, repeat what broke, and copy everything Terminal shows.
- Screenshots of anything that looks wrong (especially the pill, the menu bar icon, and see-through windows).
