# Frame Graph Pixel Diff Harness

Purpose: capture reference screenshots of typical scenes rendered
under both the legacy `RendererJob.renderFrame()` path and the new
`RenderGraph.execute()` path, and fail the build when they diverge
past a tolerance.

Used as a **Phase C gate**: every feature migration (C1…C9) must pass
the pixel-diff on all five scenes before merging.

## Files

- `runner.mjs` — Electron runner that loads a single scene, captures
  a screenshot, writes it to `_out/<scene>-<mode>.png`.
- `index.html` — harness page. Reads `?scene=<name>&mode=<legacy|fg>`
  from the URL, constructs the scene, signals completion via
  `postMessage({type:'end'})`.
- `harness.ts` — scene loader / capture logic.
- `scenes/` — per-scene manifest files. One per scene name.
- `diff.mjs` — standalone CLI: takes two PNG paths and reports
  max-delta + pixel-mismatch count. SSIM upgrade is a Phase C task.
- `_out/` — screenshots and logs (gitignored).
- `baselines/` — checked-in reference PNGs. Populated on first run
  with `npm run fg-diff:bake`.

## Usage

```bash
# Run a single scene in legacy mode and save screenshot:
npx electron test/fg-diff/runner.mjs --scene=sample_cube --mode=legacy

# Same scene under frame graph:
npx electron test/fg-diff/runner.mjs --scene=sample_cube --mode=fg

# Diff the two outputs:
node test/fg-diff/diff.mjs \
    test/fg-diff/_out/sample_cube-legacy.png \
    test/fg-diff/_out/sample_cube-fg.png
```

## Acceptance criteria (Phase C)

- Per-pixel max-delta ≤ 2 LSB on 8-bit channels.
- SSIM ≥ 0.995 (added in Phase C once the FG path is running).

## Phase A status

- [x] Runner scaffold
- [x] Scene manifest format
- [x] Max-delta diff tool
- [ ] SSIM implementation (Phase C — depends on `useFrameGraph` flag
      shipping in Phase B)
- [ ] Baseline PNG capture (waits on Phase C parity)
