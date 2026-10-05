# Phoenix Video Factory — V1 Plan (attached to Mystic Studio, not a second platform)

## Architecture map — EXISTING (verified by inspection)
- `cli.js` verb→tool dispatch (case 'vsee' → video_see …) — ATTACH: new verbs `video`, `vstatus`
- `lib/core.js` — TOOLS[] + dispatch switch; HTTP/MCP/CLI all share this surface — ATTACH: `video_run`, `video_status` tools
- `http.js` — GET /health, GET /v1/tools, POST /v1/call (forge-style async 202 + GET /v1/jobs/<id>) — REUSED as-is via TOOLS
- `server.js` — MCP stdio server, capabilities.tools — REUSED as-is via TOOLS
- `lib/config.js` — config/env (maxVideoMb=19 default, outDir, stateDir) — REUSED for guards
- Existing video intelligence: `video_see`, `video_keyframes`, `video_gif` (Gemini-based analysis) — PRESERVED; deterministic render pipeline is additive
- Tests: `node test/smoke.js` plain-script+assert style — FOLLOWED (zero-dep law, no test framework added)

## New files (one writer per file; integration owner resolves)
- `lib/video-fetch.js` — acquire: file | direct URL | page URL (yt-dlp optional, explicit unsupported error); UA, redirects≤5, timeout, max-size, content-type guard, partial cleanup, retry×1, sha256, provenance
- `lib/video-edit.js` — ffprobe wrapper, scene detect, edit-plan build+validate, ffmpeg arg builders (master/9:16/1:1/thumb/sheet/burn-in), loudness/clip/black/silent measurement
- `lib/video-captions.js` — transcript segments → SRT/VTT, monotonic sanitize within duration
- `lib/video-qc.js` — measured QC (no prose): parse/codec/geometry/duration/A-V delta/loudness/TP/clipping/zero-byte/checksums/srt-order/black+silent report
- `lib/video.js` — orchestrator: deterministic jobId, resumable stages, idempotent reruns, manifest.json, error normalization
- `test/video.js` — full matrix below (fixtures generated at test time; local HTTP server; no network dependency)

## Stages (each = manifest.stages[name]: {status, startedAt, finishedAt, outputs, warnings, error?})
acquire → probe → scenes → transcribe(optional, EXPLICIT skip when no provider) → editplan → audio(plan+measure)
→ captions → render_master → render_vertical → render_square (social preset) → thumbnail → contact_sheet → qc
(captions precede variants so burn-in has its source; jobId = sha(input+preset+caption-params); curlFetch retries network errors once)

## Presets
- `master`: H.264/AAC MP4, keep-AR scale ≤1080p, loudnorm I=-16 TP=-1.5 LRA=11, faststart, even dims
- `social`: master + vertical 1080×1920 + square 1080×1080 (fit-inside + black pad)
- `singing`: master + gentler audio chain (loudnorm single-pass + alimiter TP=-1.5), `vocal_enhance` = plugin flag (safe baseline ships; advanced = clean not-installed error, product not blocked)

## Checklist (acceptance commands → expected)
1. `node test/smoke.js` → exit 0 (existing regression intact)
2. `node test/video.js` → all sections PASS, exit 0:
   - UNIT: input classify / jobId idempotency / plan validation / srt builder / arg geometry / error codes
   - E2E: fixture (ffmpeg testsrc2+sine 8s) served by local node:http → `video run --input http://127.0.0.1:P/f.mp4 --preset social` → master.mp4, vertical.mp4, square.mp4, captions.srt/.vtt (from deterministic fixture transcript), thumbnail.jpg, contact-sheet.jpg, edit-plan.json, manifest.json, qc.json(pass=true)
   - IDEMPOTENCY: rerun same input+preset → same jobId, render stages cache-skipped, exit 0
   - FAILURE: 404→EFETCH_404; HTML-as-media→EFETCH_TYPE; truncated mp4→EPROBE; no-audio→ok(-an)+QC audio-absent; portrait/fps7→geometry ok; slow server→EGUARD_TIMEOUT; oversized→EGUARD_SIZE; page-URL w/o yt-dlp→EUNSUPPORTED_SOURCE; truncated artifact→qc fail
3. `node cli.js video <fixture> --preset social --out <dir>` → operator surface works from one command

## Assumptions
- VERIFIED: ffmpeg 7.1.5 + libx264 + aac + loudnorm + subtitles(libass) + blackdetect + silencedetect; Node v24; zero-dep repo; TOOLS dispatch; async job HTTP surface; DejaVu fonts present; repo cloned to /home/z/mystic-studio (branch main)
- INFERRED: yt-dlp absent → page-URL adapter ships as explicit-error adapter (install hint); Gemini transcript path exists (video_see) but core acceptance uses deterministic transcript fixture (no keys, no network)
- UNKNOWN at plan time: none blocking; http.js async-name list checked during wiring
