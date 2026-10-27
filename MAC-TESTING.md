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

## 7. New in this version

- [ ] After Cloak has started once, press `Cmd+Space` and type **Cloak**. Is there a Cloak app with the orange hooded logo? Quit Cloak (menu bar icon, Quit) and open it from Spotlight: does it start?
- [ ] Settings, General, **Open Cloak like any app**: does it say Cloak is in your Applications folder? Does **Show in Finder** show it?
- [ ] The pill and the menu bar icon show the Cloak logo (not the old star). Settings, Appearance, **Icon**: switch to Classic, then pick a picture of your own. Does the pill change each time?
- [ ] Settings, Appearance, **Background color**: pick Navy. Do the pill and Settings turn dark blue?
- [ ] Setup guide (Settings, General, Setup guide, then Next to **Connect Claude**): if you're already signed in, is step 2 ticked off by itself? (To try a fresh sign-in, run `claude auth logout` in Terminal first, click **Sign in**, finish in the browser, and watch it tick off without clicking anything else.)
- [ ] Ask the chat "Explain how photosynthesis works." Is the answer a few lines, not paragraphs? Is there a **Continue in Claude** button?
- [ ] Switch to **Homework** mode, open YouTube for 4 minutes. Did macOS ask for Screen Recording (if not already allowed)? Did a "Back to it?" notification appear?
- [ ] Open the **Talk** widget (menu bar icon, Talk) and click **Set up Talk** (a big download). Then **Start talking**. Did macOS ask for the microphone? Say "What's the capital of Japan?" and pause. Does your question appear, and does a natural-sounding voice say the answer within a few seconds? Click the circle while it's talking: does it stop? Try another voice from the list.
- [ ] Stay quiet with the TV or music on for a minute while Talk is on. Does it ever "hear" a question nobody asked?
- [ ] Tasks: is there a **Done** tab with your finished tasks?
- [ ] Put the Mac to sleep for a few minutes, wake it, and click a widget's button. Does it open with its content?

## What to send back

- This list with your notes.
- Anything Terminal printed if something failed. The easiest way to see errors: quit Cloak (menu bar icon, Quit), then in Terminal run `npm start` inside the Cloak folder, repeat what broke, and copy everything Terminal shows.
- Screenshots of anything that looks wrong (especially the pill, the menu bar icon, and see-through windows).
