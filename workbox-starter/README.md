# Phoenix Digital — Visual Production Workbox Starter

**Give us the source material and reference. Get back finished visual production.**

This public starter shows how to prepare a bounded visual job and check a real result with Mystic Studio. The supplied demonstration is an original, generic fixture. It is not a client project, a claim that an automated model created the after version, or evidence of a hosted production service.

## What goes in and comes out

| Input | Purpose | Result |
| --- | --- | --- |
| Source assets and their provenance | Establish which exact copy, identity and media may be used | Asset inventory with source hashes and permissions |
| Approved reference and `design-spec.template.json` | Lock palette, type, layout, motion and one signature element | Reviewable design direction before editing |
| `brief.template.json` | State format, size, destination and acceptance rules | A bounded job, never an open-ended promise |
| Edited source | Build the visual in the existing project or approved editor | Desktop/mobile renders, visual verdict, corrections and finished exports |

The free material includes templates, the example and documented local commands. It does not include hosting, a managed job, paid generation, provider credits, a free-job token, commercial licenses to third-party assets or a promise of automatic repair. The service scope and any price are agreed separately. Never put an API key or private customer material in a public repository.

Studio also exports a small original website motion prototype without a provider key:

```sh
mystic-studio motion-build --headline "A considered collection" --description "Original objects for everyday living." --action "Enquire" --destination "mailto:studio@example.com" --motion gsap,lenis
```

It saves one deterministic HTML file under Studio's configured output directory; rerunning the same input overwrites that file. The page works without JavaScript and respects reduced motion. Optional GSAP and Lenis load from public CDNs; review their upstream licenses and check offline, mobile and runtime behaviour before using a result in a real website. Vanta requires a WebGL project and React Bits requires a React project, so this standalone HTML export does not pretend to include them. The four source notes are in `mystic-studio motion`.

`demo/motion.html` is a checked-in original output with a working `#details` action. The local render script includes it at 1440, 390 and 320 pixels alongside before/after. A screenshot captures one frame only; inspect motion and the static fallback in a browser before client delivery.

## Repeatable sample

The two HTML files under `demo/` contain the **same made-up headline and action**. `before.html` deliberately has cramped type, weak contrast and a fixed width that overflows on phones. `after.html` uses the locked specification: two type families, clear hierarchy, one action and a fluid layout. Inspect the source and compare the renders; this is a real source edit, not an AI-generated customer result.

From the repository root:

```sh
npm test
node workbox-starter/render-demo.mjs
```

`render-demo.mjs` serves only the three local files on loopback, calls the existing `shot.js`, and overwrites `workbox-starter/output/{before,after,motion}-{1440,390,320}.png` plus health sidecars. It needs a local Chromium and Playwright, as `mystic-studio doctor` reports. The output directory is ignored by Git; running it twice does not add source files. No provider call or key is needed for these captures. Review the actual PNGs before accepting the change.

For a job on your own URL, use the existing tools after you have permission to process its assets:

```sh
mystic-studio shot https://example.com --widths 1440,390,320
mystic-studio review https://example.com --brief "Compare with the approved reference and design specification"
```

`review` sends screenshots to the configured Gemini provider. Inspect its defects and fix the source in your editor, then use `recheck` with the session ID returned by the review. `polish` can hand bounded fixes to a configured external coding runner, but that runner has your user permissions and is not a sandbox; see [SECURITY.md](../SECURITY.md). Image generation/editing uses optional paid provider credits and is never a default step. Review and reference comparison are model judgments, so check the actual render and page health yourself before exporting.

## Job contract

1. **Inspect.** Inventory local source/reference files, rights, identity constraints and hashes. Reject unknown or conflicting material.
2. **Specify.** Fill both JSON templates. Agree palette (four to six named colours), at most two type families, layout, motion, one signature element and measurable sizes.
3. **Edit or generate.** Work on a copy in the existing project. Use generation only with a configured provider, explicit budget and rights clearance.
4. **Render.** Capture 1440, 390 and 320 pixel widths. Check text, overflow, loaded images and the actual CTA destination.
5. **Compare and repair.** Check the approved reference and the health sidecars, fix concrete defects in the source, then render again. Cap the number of rounds. Reject identity drift and fabricated content.
6. **Export.** Return the final files, proof images, exact source revision and a concise record of remaining limitations. The reviewer approves the actual export.

## Hosted trial status

This repository's HTTP API accepts a configured owner token on a locally bound job server. It has no authenticated customer identity, tenant isolation, metered provider execution or atomic three-job customer quota. A public token would therefore be unsafe to treat as a three-job trial. No trial token is issued here; do not give a customer raw provider API keys. The [Phoenix Digital Workbox offer](https://phoenix-digital-systems.mysticwellnesssydney.workers.dev/visual-production-workbox) is the contact path for a managed job.
