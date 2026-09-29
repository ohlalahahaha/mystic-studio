# Deterministic poster_render review evidence

This folder contains a generic renderer **TEST FIXTURE** only. It contains no customer, TRI ÂN, Phoenix Live, Mystic Wellness, face, or private HQ asset.

- `poster-test-fixture.png` — lossless 1200×1500 RGBA output at the requested 4:5 canvas.
- `poster-test-fixture.pdf` — one-page RGB PDF, 288×360 pt / 4×5 inches at 300 DPI.
- `poster-test-fixture.html` — self-contained editable HTML/SVG source with data-URI image/font resources and script/network-blocking CSP.
- `poster-test-fixture.qa.json` — runtime-observed dimensions, decoded source dimensions, exact font faces, checksums, validation, provenance and limitations; no invented test exit codes.
- `poster-test-fixture-alpha.png` — original 800×800 geometric RGBA source fixture used for crop/alpha proof.
- `poster-test-fixture.checksums.json` — SHA256 hashes of the PNG, PDF, HTML, QA and alpha-source artifacts.
- `poster-test-fixture-proof.json` — actual direct/CLI/MCP/HTTP, PDF and negative-check results from the browser integration harness.
- `test-receipt.md` — exact source-bound commands and exit codes from the final acceptance run.

The fixture uses literal Vietnamese text `Kiểm tra chữ Việt — Đặng Ánh`, restrained charcoal/ivory/gold, and two font-family aliases backed by one portable local font file. The first image uses a nonzero asymmetric source crop; a second small crop sits near the page edge so PDF/PNG physical scaling is checked at more than one location.

The browser integration exercises direct dispatch, CLI, stdio MCP and HTTP, then checks schema equality, decoded-dimension mismatch, unsupported DPI, unknown manifest fields, text overflow, hash/symlink/path safety, source-byte preservation, alpha, image-only/text-only vacuous validation, PDF text, and rendered PDF/PNG content alignment.

Actual PNG and PDF-raster pixels were inspected after the clean-source run: Vietnamese glyphs are intact, the asymmetric geometry matches, no text clips, and the edge marker appears in the same physical location. This is renderer proof only: RGB output is not CMYK/PDF-X or print-readiness certification, and technical proof is not artistic approval.

The repository exposes CLI, stdio MCP and localhost HTTP surfaces. Those do not constitute native ChatGPT Work/plugin registration; the remaining integration gap is a separately authorized authenticated reachable HTTPS endpoint plus the product-side registration mechanism actually available at that time.