# Poster render proof

- `poster/poster.png` — 300×450 lossless RGBA PNG; transparent background and source alpha are preserved.
- `poster/poster.pdf` — one-page 144×216 pt (2×3 inch / 150 DPI) PDF with extractable Vietnamese text.
- `poster/source.html` — editable self-contained source with data-URI image/fonts and script-blocking CSP.
- `poster/qa-receipt.json` — checksums, source/output dimensions, validation facts, provenance and limitations.

## Verification

- Base and head SHA: `0552616b67d9965a6b970a3492ca7f7fd14b9cb5` (worker leaves changes unstaged).
- `npm test` — exit `0`; offline smoke and negative hash/path/symlink/source-safety tests pass.
- `MYSTIC_STUDIO_REPO_SHA=$(git rev-parse HEAD) npm run test:browser` — exit `0`; real Chromium PNG/PDF/text/Vietnamese/alpha/original-byte/overflow checks pass.
- `git diff --check` — exit `0`.
- Vision self-check (`python3 /home/runner/work/_temp/hq-toolbelt/scripts/vlm-check.py deliverable/poster/poster.png`) — exit `0`, `VERDICT: PASS`.

## Limits

- RGB PNG/PDF only: not CMYK, PDF/X, print-ready, artist-approved, or face-identity verified.
- Enlargement is interpolation and is flagged, never described as native added detail.
- `poster_render` is stdio/REST dispatch through the existing Studio surfaces, not live ChatGPT registration.
