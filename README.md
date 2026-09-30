# mystic-studio

## Phoenix Digital — Visual Production Workbox

The [Visual Production Workbox](https://phoenix-digital-systems.mysticwellnesssydney.workers.dev/workbox) is the done-for-you commercial service built around Mystic Studio: visual finishes, campaign sets and existing-page refinements. It uses a scoped quote and the existing Phoenix Digital contact route. It is not a self-service generation subscription.

### Public Starter

The [public Workbox Starter](workbox-starter/README.md) contains a reusable brief, design specification, a generic before/after fixture, and a repeatable render/check workflow. It uses this Studio's existing review and screenshot tools; it is not a hosted visual-job trial.

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

**Signature treatments:** a treatment is a complete premium idiom — exact CSS tokens, the moves that spend them, and the guards that keep them tasteful — distilled from a shipped build. `mystic-studio treatments` lists them; `mystic-studio treatments golden` prints the full recipe. Build with it, then declare it: `mystic-studio review <url> --treatment golden`. The reviewer then judges *within* the idiom (a ~5% gold pixel budget is restraint, not timidity) instead of demanding generic minimalism — and still flags drift past the guards. If a page reads generic with no treatment declared, the reviewer names one in its fixes.

**Optional motion sources:** `mystic-studio motion` lists Lenis, GSAP, Vanta and React Bits with upstream links, integration notes and guards. Select a source in an existing website fix loop with `mystic-studio polish --url http://localhost:3000 --repo ~/code/mysite --motion gsap` (or `--motion gsap,lenis`). Studio passes those source notes to its existing coding runner only when a top fix calls for animation. It does not install packages globally or copy components into Studio. Lenis smooths scrolling; GSAP handles timelines and scroll animation; Vanta supplies WebGL/p5 backgrounds; React Bits is for React projects. Use static fallbacks, reduced-motion handling, mobile performance checks and the upstream licenses. React Bits' MIT + Commons Clause permits use in an application but restricts resale or redistribution of the components themselves. Screenshot review checks rendered frames and page health; it cannot prove animation timing or smoothness.

**Runnable prototype:** `mystic-studio motion-build --headline "A considered collection" --description "Original objects for everyday living." --action "Enquire" --destination "mailto:studio@example.com" --motion gsap,lenis` exports one responsive HTML section in the configured output directory. It has an original CSS visual, a real CTA, static fallback, reduced-motion handling, and optional GSAP/Lenis scripts loaded from pinned public CDNs. Identical inputs overwrite the same filename. Render it at 1440, 390 and 320 pixels, then check its output and page health before adapting it to a real brief. This is a prototype, not a reference-faithful customer deliverable. Vanta and React Bits remain project-specific because they require a WebGL dependency or a React project; `motion` shows their integration guards.

## Image generation — higgsfield, Z.ai GLM-Image, or native Gemini (Nano Banana)

`photo_generate` is paid. Four providers, explicit selection, no silent fallback:

```sh
# higgsfield CLI (default — prepaid credits)
mystic-studio generate "a foggy harbor at dawn" --ar 16:9

# Z.ai hosted GLM-Image — paid API, $0.015/image, text-to-image only
mystic-studio generate "a foggy harbor at dawn" --provider glm --size 1728x960 --quality hd

# native Gemini "Nano Banana" — paid API usage billed by Google separately from any chat subscription

# OpenAI GPT Image — paid API usage billed by OpenAI
mystic-studio generate --provider openai --prompt "a foggy harbor at dawn" --ar 16:9 --quality high --output-format png
mystic-studio edit input.png -p "keep the subject and replace the sky" --provider openai --size 1536x1152 --quality high
mystic-studio generate --provider gemini --prompt "a foggy harbor at dawn" --ar 16:9
mystic-studio generate --provider gemini --prompt "a foggy harbor at dawn" --model gemini-2.5-flash-image
mystic-studio edit ~/Desktop/mystic-studio/harbor.png -p "make the sky golden" --provider gemini
```

- **Provider selection:** pass `provider` per call (`"higgsfield"`, `"glm"`, or `"gemini"`) or set `"imageProvider"` in config (default `higgsfield`, so existing setups keep working). An unknown provider, a missing key, or a failed call is an error — mystic-studio never quietly switches provider or retries.
- **OpenAI provider:** direct documented Image API (no SDK dependency), model `gpt-image-2`, generate and edit. Aspect mappings preserve ratio (`16:9` = `1536x864`, `4:3` = `1536x1152`); custom sizes must be multiples of 16 with max edge 3840, area 655360-8294400, and ratio <=3. Edits always use high input fidelity: `input_fidelity` is not sent and cannot be overridden. The adapter validates source dimensions/trailer before the paid call, saves native bytes, and writes a receipt; a receipt failure never deletes paid output. Timeouts are terminal and ambiguous — no retry, duplicate render, or provider fallback.
- **GLM-Image is text-to-image only.** `photo_edit` with `provider: "glm"` is rejected explicitly — the hosted API has no image input; editing stays on higgsfield (pass `provider: "higgsfield"` explicitly). No self-hosting; only the hosted `glm-image` model is used and other model names are rejected. Provider API errors are reported as sanitized status + error codes — response bodies are never echoed.
- **Sizes:** default `1280x1280`; recommended set: `1568x1056`, `1056x1568`, `1472x1088`, `1088x1472`, `1728x960`, `960x1728`; custom sizes with both sides a multiple of 32 within 512–2048. `aspect_ratio` maps `1:1`/`16:9`/`9:16` to the recommended square/landscape/portrait sizes; other ratios must pass `size` explicitly.
- **Key:** `ZAI_API_KEY` in your shell, `~/.config/mystic-studio/.env`, or the canonical `~/.config/mystic/.env`. It is used server-side only: sent as a Bearer header to `api.z.ai` for the generation call and **never** to the image download host; never logged or printed. A missing key gives an actionable error, not a fallback.
- **Paid status:** `photo_generate` labels itself as spending money in every tool listing (MCP tools/list, HTTP /v1/tools, CLI help) — GLM-Image costs $0.015/image. Call it only when the user explicitly asked for generated media; failed paid calls are never auto-retried.
- Output lands in `outDir` (default `~/Desktop/mystic-studio`); the result reports the real saved file, provider, model and size. Works identically over MCP and the HTTP API:

```sh
curl -s localhost:7817/v1/call -d '{"name":"photo_generate","arguments":{"prompt":"a foggy harbor at dawn","provider":"glm","size":"1728x960"}}'
```

- Catalog: `mystic-studio catalog --provider glm` lists the GLM-Image model, sizes and paid status; `mystic-studio doctor` reports key presence (never the value) and marks live generation as unverified.

## Tools

| Tool | What it does | Costs money? |
|---|---|---|
| `photo_see` | Photography critique: composition, light, defects, print-readiness, SCORE /100 | no |
| `web_review` | Desktop + mobile screenshot, design verdict + top-3 fixes + SCORE /100 | no |
| `recheck` | Delta review against a previous session: what changed, which fixes landed | no |
| `web_audit` | Crawls a whole site (default 8 pages), per-page verdicts, site SCORE, **cross-page consistency police** | no |
| `polish` | **Autonomous loop:** review → coding runner applies fixes → delta-recheck → repeat until SHIP (round + budget capped) | runner time |
| `taste_note` | Teach the reviewer a preference for a site; reviews also store their top fixes automatically — taste sharpens every round | no |
| `treatments` | Signature premium design idioms (tokens + moves + guards) from shipped builds; pass one to `web_review` and the verdict judges within it | no |
| `motion_assets` | Optional Lenis, GSAP, Vanta and React Bits recipes for website fixes; `polish` accepts `motion` ids | no |
| `motion_prototype` | Export an original responsive HTML section with optional GSAP/Lenis motion and static fallback | no |
| `web_shot` | Screenshots, any widths, full-page option; `health: true` adds rendered-DOM page health | no |
| `video_see` | Scene summary, timestamped timeline, transcription, quality verdict | no |
| `video_keyframes` | N evenly-spaced frames as JPGs | no |
| `video_gif` | Two-pass palette GIF from a video span | no |
| `studio_doctor` | Dependency check with fix instructions | no |
| `photo_generate` | Text → image: higgsfield (default), GLM-Image, Gemini, or OpenAI (`gpt-image-2`) | **credits / paid API** |
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

`~/.config/mystic-studio/config.json` (copy `config.example.json`) or `./mystic-studio.config.json`. Everything has working defaults; nothing is pinned — binaries resolve from `PATH`, the browser is auto-discovered. Env overrides: `GEMINI_API_KEY`, `ZAI_API_KEY`, `MYSTIC_STUDIO_TOKEN`, `MYSTIC_STUDIO_OUT`, `MYSTIC_STUDIO_PORT`, `MYSTIC_STUDIO_CHROME`, `MYSTIC_STUDIO_FLASH`, `MYSTIC_STUDIO_PRO`, `MYSTIC_STUDIO_IMAGE_PROVIDER`, `MYSTIC_STUDIO_GLM_BASE`.

| Key | Default | Notes |
|---|---|---|
| `outDir` | `~/Desktop/mystic-studio` | screenshots, frames, GIFs |
| `allowDirs` | `[]` | extra folders `photo_see`/`video_*` may read locally |
| `allowFileUrls` | `false` | let `web_shot` shoot `file://` URLs (dangerous — see SECURITY.md) |
| `flashModel` / `proModel` | `gemini-3.8-flash` / `gemini-3.1-pro-preview` | `--deep` uses the pro model |
| `codingRunner` | `glm-run` | command `mystic-coding-room` drives |
| `imageProvider` | `higgsfield` | default for `photo_generate` — per-call `provider` wins; `glm` = Z.ai GLM-Image |
| `glmImageBase` | `https://api.z.ai/api/paas/v4` | GLM-Image API base override (for testing) |
| `openaiImageBase` | `https://api.openai.com/v1` | OpenAI Image API base override (for testing) |
| `openaiImageModel` | `gpt-image-2` | explicit OpenAI image model |
| `canonicalEnvFile` | `~/.config/mystic/.env` | extra secret file consulted for `ZAI_API_KEY` if not found elsewhere |

## Requirements

- Node ≥ 18, curl
- A free Gemini API key (all analysis)
- Optional: `ffmpeg` (video tools — `brew install ffmpeg` / `apt install ffmpeg`), a Chromium for screenshots (`npx playwright install chromium`), the [higgsfield CLI](https://github.com/Open-Higgsfield-AI) or a [Z.ai](https://z.ai) API key (image generation — GLM-Image is $0.015/image, paid), or an OpenAI API key (`provider: "openai"`; paid)
- `mystic-studio doctor` tells you exactly which of these you're missing and how to install them.

## Proven

Built and battle-tested on a working estate before release: wedding-industry client sites reviewed and iterated to SHIP via the recheck loop, poster photography graded, promo videos dissected frame-by-frame. CI runs the offline smoke suite on macOS and Linux.

## License

MIT
