# Job #134 exact-source test receipt

- Remote review branch at start: `ledger/job-134` @ `9351eb63953d37bcf3f7919659b59a88d932d941`.
- Current `main` observed at start: `0552616b67d9965a6b970a3492ca7f7fd14b9cb5`.
- Clean tested implementation commit: `9969fc4016fdf0dd152e0d326bcb718202b666ae`.
- Tested implementation tree: `c6ae3c7cccaa4fe81f201df58b56ab5079549b80`.
- Runtime `qa-receipt.json` independently records that exact commit/tree as clean (`working_tree_dirty=false`, `repository_head_if_clean=9969fc4…`) plus per-file implementation SHA256 hashes.

## Commands actually run on the clean implementation commit

- `npm test` -> exit **0**: offline smoke suite passes on macOS with portable font discovery; typed manifest schema, hash/path/symlink safety and unsupported DPI rejection are included.
- `PLAYWRIGHT_CORE=$HOME/.zcode/mcp/pinned/node_modules/playwright-core/index.js MYSTIC_STUDIO_CHROME=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome npm run test:browser` -> exit **0**: real Chrome integration passes.
- `git diff --check` -> exit **0** in the same final command.

## Browser integration facts

- Required generic fixture is 1200×1500 at 300 DPI with literal `Kiểm tra chữ Việt — Đặng Ánh`, TEST FIXTURE label, charcoal/ivory/gold and a geometric alpha source.
- Direct `run.js`, CLI, stdio MCP `tools/call`, and HTTP async dispatch all succeed. HTTP unknown-tool error returns 400; MCP schema and HTTP schema agree.
- Nonzero asymmetric crop is pixel-checked against the original source. The single-page PDF is 288×360 pt / 4×5 inches; rasterized PDF pixels match the PNG at the crop and near the page edge.
- PDF text extraction retains Vietnamese accents. On this macOS run the deterministic proof used `mdimport+plutil` for text and `sips` for PDF rasterization; the suite uses Poppler equivalents when available.
- Exact font family/weight aliases (`Fixture Sans` 400 and `Fixture Display` 700) both load even though they share source bytes.
- Declared-vs-decoded source dimensions, invalid DPI 36/1200, unknown manifest fields and text overflow fail closed. Image-only/text-only validation is vacuously true where appropriate.
- Original alpha/image bytes remain unchanged on success and failure; the transparent-output check passes.

## Review boundary

No paid model/vision/media provider was called. No customer/business asset, face, private HQ source, account/OAuth setting, `.github` workflow, merge, deployment or publication was changed. The result is ready for Astra's diff/application/push review only.