# Security — honest limits

Read this before exposing mystic-studio to anything you do not fully control.

## What the tools can reach

| Surface | Reach | Limit |
|---|---|---|
| `web_shot` / `web_review` | Fetches any URL you give it and renders it in a local headless Chromium | `file://` URLs are **refused by default** (they would read local files). Set `allowFileUrls: true` only if you understand that. Screenshots land in `outDir`. |
| `photo_see` / `photo_edit` / `video_*` (local paths) | **Reads local files** you point it at | Paths must be inside the allowed read set: current working dir, `outDir`, system temp, plus anything you add to `allowDirs`. Everything else is refused. |
| `photo_generate` / `photo_edit` / `studio_catalog` | Calls your configured higgsfield/Muapi account | **Spends real prepaid credits per call.** Never auto-retry these. |
| `web_review`, `photo_see`, `video_see`, `recheck` | Sends the image/video **to Google Gemini** for analysis | Whatever media you analyze leaves your machine. Don't feed it secrets. |
| `mystic-coding-room` | Runs an external coding agent **with your user's full permissions** inside a repo | The destructive-command preflight is **advisory** — a filter on the contract text, not a sandbox. The agent can technically do anything your user can. Only point it at repos you can afford to lose; keep backups. |

## HTTP API

- Binds `127.0.0.1` by default. On localhost only, no token needed.
- If you expose it (LAN, tunnel, container), **set a token**: `MYSTIC_STUDIO_TOKEN` env or `"token"` in config. Without it anyone who can reach the port can read local media, spend your generation credits, and run jobs.
- The token comparison is timing-safe.

## Secrets

- The Gemini key is read from `~/.config/mystic-studio/.env` (or `GEMINI_API_KEY` env) and used only in the `Authorization` header. It is never logged, never written to jobs/sessions, never printed in errors.
- Session and job files contain media paths and verdict text only — no keys.

## Known non-goals

- No sandboxing of the coding runner. The lock file, watchdog, and preflight are coordination and hygiene, not isolation.
- Screenshots execute a real browser against real pages — treat public-URL reviews as viewing untrusted content in an isolated headless profile (default), and avoid shooting internal admin panels.
- No rate limiting on the HTTP API.
