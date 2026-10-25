#!/bin/bash
# Cloak for macOS: double-click this file (the Mac version of start.bat).
cd "$(dirname "$0")" || exit 1
# Apps opened from Finder don't get Homebrew's or the Node.js installer's folders on PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! command -v npm >/dev/null; then
  echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, then double-click start.command again."
  exit 1
fi
# First run (or after a fresh download): install Electron and the other dependencies.
if [ ! -d "node_modules/electron/dist/Electron.app" ]; then
  echo "Setting up Cloak for the first time. This takes a minute..."
  if ! npm install; then
    echo
    echo "Setup failed. Make sure Node.js is installed: https://nodejs.org"
    exit 1
  fi
fi
# Opened through macOS rather than from this window, so closing the window doesn't close Cloak, and the
# permission prompts (Screen Recording, Microphone) are for "Electron" rather than Terminal.
open "node_modules/electron/dist/Electron.app" --args "$PWD"
echo "Cloak is starting. You can close this window."
