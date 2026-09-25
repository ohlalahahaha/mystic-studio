# mystic-studio

**A zero-dependency AI media studio your coding agent can actually use.**

Give Claude, ChatGPT, Codex, Gemini CLI or any MCP client three things it never had:

- **A photography eye** — point it at any image, get a print-director's verdict: defects ranked, top-3 fixes, SHIP or not.
- **A design director** — it screenshots your web page at desktop + mobile and returns a blunt SHIP / NOT SHIPPABLE verdict with the three highest-payoff fixes.
- **A memory loop** — every review is a session. After you fix the page, `recheck` compares before/after and tells you *which fixes actually landed*. Review → fix → re-review, without babysitting.

Plus screenshots, video intelligence (scene timeline, transcription, verdicts), keyframes, palette-optimized GIFs, and optional image generation/editing.

**Zero npm dependencies.** Node 18+, `curl`, and a free Gemini API key. That's the whole install.

---

## Quick start

```sh
git clone https://github.com/ohlalahahaha/mystic-studio
cd mystic-studio
./install.sh                 # or: npm i -g .

# add your key (free: https://aistudio.google.com/apikey)
cp .env.example ~/.config/mystic-studio/.env
$EDITOR ~/.config/mystic-studio/.env

mystic-studio doctor         # checks every dependency, tells you how to fix gaps
mystic-studio review https://your-site.com --brief "landing page for a wedding MC"
```

Output is a structured verdict, not a vibe:

```
VERDICT: NEAR SHIP — strong hierarchy, mobile reflow breaks it.
TOP 3 FIXES:
  1. Hero heading: 44px on mobile overflows — drop to clamp(28px, 8vw, 44px).
  2. CTA button below the fold at 390px — move above the testimonial row.
  3. 4 accent colours on one page — keep the gold, mute the rest.
```

## The agent loop (the point)

```
mystic-studio review https://mysite.com        # → score: 62/100, session: 20260923-1015-mysite
   ... your agent edits the code ...
mystic-studio recheck 20260923-1015-mysite     # → FIXES LANDED: #1 DONE, #2 PARTIAL, #3 OPEN
```

`recheck` re-shoots the page and grades the delta against the previous verdict — so an AI agent can iterate on design without a human staring at screenshots. Works for images too (`see` → edit → `recheck --image new.png`).

**Fully autonomous mode:**

```
mystic-studio polish --url http://localhost:3000 --repo ~/code/mysite --max-rounds 3
```

`polish` runs the whole loop itself: review → hand the top fixes to your coding runner (any command with the `mystic-coding-room` interface) → delta-recheck → repeat until SHIP, round-capped and budget-capped, with a transcript saved per round. Every review also feeds the **taste memory** — next round's reviewer remembers what was already asked for, and `mystic-studio note --target ... --note "owner hates purple"` teaches it permanent preferences.

**Whole-site audits:** `mystic-studio audit https://mysite.com` crawls up to N same-host pages and judges the *site*: per-page verdicts, one score, and cross-page consistency (nav, colour, type, spacing drift between pages).

## Tools

| Tool | What it does | Costs money? |
|---|---|---|
| `photo_see` | Photography critique: composition, light, defects, print-readiness, SCORE /100 | no |
| `web_review` | Desktop + mobile screenshot, design verdict + top-3 fixes + SCORE /100 | no |
| `recheck` | Delta review against a previous session: what changed, which fixes landed | no |
| `web_audit` | Crawls a whole site (default 8 pages), per-page verdicts, site SCORE, **cross-page consistency police** | no |
| `polish` | **Autonomous loop:** review → coding runner applies fixes → delta-recheck → repeat until SHIP (round + budget capped) | runner time |
| `taste_note` | Teach the reviewer a preference for a site; reviews also store their top fixes automatically — taste sharpens every round | no |
| `web_shot` | Screenshots, any widths, full-page option; `health: true` adds rendered-DOM page health | no |
| `video_see` | Scene summary, timestamped timeline, transcription, quality verdict | no |
| `video_keyframes` | N evenly-spaced frames as JPGs | no |
| `video_gif` | Two-pass palette GIF from a video span | no |
| `studio_doctor` | Dependency check with fix instructions | no |
| `photo_generate` | Text → image via higgsfield | **credits** |
| `photo_edit` | Instruction-based image edit | **credits** |
| `studio_catalog` | List available generation models | no |

### Page health (rendered-DOM truth, not impressions)

A screenshot cannot prove that assets actually rendered: HTTP 200s and matching selectors
still let a thumbnail grid fill while the hero never paints. When `web_review`, `recheck`
and `web_audit` capture pages (and `web_shot` when you pass `health: true`), the shot
helper also collects deterministic rendered-DOM facts into a `.health.json` sidecar next
to each PNG: HTTP errors ≥ 400, images that loaded with zero rendered pixels (broken),
images still pending at capture (lazy-load timing — reported separately so it is never
confused with broken), and console/page errors. Those facts are prepended to the review
prompt **and** appended to the returned verdict, so the ground truth survives even when
the model wants to say SHIP.

## Three surfaces, one engine

- **MCP server** — for Claude Code, ZCode, Cursor, any MCP client:
  ```json
  { "mystic-studio": { "command": "node", "args": ["/path/to/mystic-studio/server.js"] } }
  ```
- **HTTP API** — for ChatGPT connectors, scripts, other agents. Async jobs, so long reviews don't time out:
  ```sh
  mystic-studio-http                        # 127.0.0.1:7817
  curl -s localhost:7817/v1/call -d '{"name":"web_review","arguments":{"url":"https://example.com"}}'
  # → {"job_id":"j-..."}   then poll:  curl -s localhost:7817/v1/jobs/j-...
  curl -s localhost:7817/v1/tools           # tool list with schemas
  ```
  Set `MYSTIC_STUDIO_TOKEN` and send `X-Studio-Key: <token>` before exposing the port beyond localhost.
- **CLI** — for humans and shell agents: `mystic-studio see|shot|review|recheck|vsee|vgif|doctor|serve`
- **`mystic-coding-room`** — bonus: run an external coding agent on a repo under a written contract with a verdict, a one-writer lock, and a 25-minute watchdog. Bring your own runner (any command with the interface in `coding-room.js`). See `SECURITY.md` for its honest limits.

## ChatGPT connector

1. Run `mystic-studio-http` on a machine ChatGPT can reach (set `MYSTIC_STUDIO_TOKEN` first).
2. In ChatGPT: Settings → Connectors → Create → point the Action at `https://your-host:7817/v1` and paste `/v1/tools` output as the action list.
3. Ask ChatGPT to review a URL — it gets the same verdicts your coding agent does.

## Configuration

`~/.config/mystic-studio/config.json` (copy `config.example.json`) or `./mystic-studio.config.json`. Everything has working defaults; nothing is pinned — binaries resolve from `PATH`, the browser is auto-discovered. Env overrides: `GEMINI_API_KEY`, `MYSTIC_STUDIO_TOKEN`, `MYSTIC_STUDIO_OUT`, `MYSTIC_STUDIO_PORT`, `MYSTIC_STUDIO_CHROME`, `MYSTIC_STUDIO_FLASH`, `MYSTIC_STUDIO_PRO`.

| Key | Default | Notes |
|---|---|---|
| `outDir` | `~/Desktop/mystic-studio` | screenshots, frames, GIFs |
| `allowDirs` | `[]` | extra folders `photo_see`/`video_*` may read locally |
| `allowFileUrls` | `false` | let `web_shot` shoot `file://` URLs (dangerous — see SECURITY.md) |
| `flashModel` / `proModel` | `gemini-3.8-flash` / `gemini-3.1-pro-preview` | `--deep` uses the pro model |
| `codingRunner` | `glm-run` | command `mystic-coding-room` drives |

## Requirements

- Node ≥ 18, curl
- A free Gemini API key (all analysis)
- Optional: `ffmpeg` (video tools — `brew install ffmpeg` / `apt install ffmpeg`), a Chromium for screenshots (`npx playwright install chromium`), the [higgsfield CLI](https://github.com/Open-Higgsfield-AI) (generation)
- `mystic-studio doctor` tells you exactly which of these you're missing and how to install them.

## Proven

Built and battle-tested on a working estate before release: wedding-industry client sites reviewed and iterated to SHIP via the recheck loop, poster photography graded, promo videos dissected frame-by-frame. CI runs the offline smoke suite on macOS and Linux.

## License

MIT
