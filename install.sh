#!/bin/sh
# Install mystic-studio: global npm link if possible, else symlinks into ~/.local/bin.
set -e
command -v node >/dev/null 2>&1 || { echo "need node >= 18 first"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "need curl"; exit 1; }
chmod +x cli.js http.js coding-room.js run.js shot.js server.js 2>/dev/null || true

if npm link --silent 2>/dev/null; then
  echo "installed via npm link: mystic-studio, mystic-studio-http, mystic-coding-room"
else
  BIN="$HOME/.local/bin"; mkdir -p "$BIN"
  ln -sf "$PWD/cli.js" "$BIN/mystic-studio"
  ln -sf "$PWD/http.js" "$BIN/mystic-studio-http"
  ln -sf "$PWD/coding-room.js" "$BIN/mystic-coding-room"
  echo "symlinked into $BIN (make sure it is on your PATH)"
fi

mkdir -p "$HOME/.config/mystic-studio"
[ -f "$HOME/.config/mystic-studio/.env" ] || cp .env.example "$HOME/.config/mystic-studio/.env"
echo
echo "next: put your GEMINI_API_KEY in ~/.config/mystic-studio/.env, then run: mystic-studio doctor"
