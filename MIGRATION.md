# Migration Guide

## v2 (frame-graph + linear-HDR pipeline)

This version aligns Orillusion's color and tonemap pipeline with
industry-standard linear-HDR rendering — the same architecture used
by glTF 2.0 reference, three.js, Filament, Unity URP/HDRP, and
Unreal. The change is invisible at the API level but **scenes will
render with different brightness, contrast, and saturation than v1**.
Most existing samples and user scenes will need light intensity /
material parameter adjustments to match their old look — this is
expected and matches what every other engine has gone through during
their own linear-HDR transitions (e.g., three.js r150's
`ColorManagement.enabled = true` rollout).

### What changed architecturally

| Subsystem | Before | After |
|---|---|---|
| Color textures (color/emissive) | `rgba8unorm`, sRGB-encoded bytes interpreted as linear | `rgba8unorm-srgb` when loaded as `colorSpace: 'srgb'` (hardware decode), shader-side `gammaToLiner` otherwise |
| Data textures (normal/AO/roughness/etc.) | `rgba8unorm`, treated correctly as linear | unchanged — `colorSpace: 'linear'` is the default |
| Swapchain | `bgra8unorm` (no GPU encode) | `bgra8unorm` configure + `bgra8unorm-srgb` view (hardware linear → sRGB encode at present) |
| Lit fragment output | `LinearToGammaSpace(linear)` written to GBuffer | linear HDR written to GBuffer; tonemap + sRGB encode happen at the very end |
| Inline tonemap in lighting | `ACESToneMapping(lit, intensity)` per-light | none — single ACES pass at end of post chain |
| Bloom composite | `saturate(pow(ACES(bloom), 1/2.2)) + scene` | `bloom + scene` linearly added; ACES handles compression |
| Mid-shader gamma calls | `LinearToGammaSpace(env_sample)` etc. compressing HDR mid-shader (5 sites) | removed — HDR retained until final tonemap |

### What's now in the post chain

```
ColorPass (linear HDR, no inline tonemap)
   |
   v
SceneColorPyramid (linear HDR, mip chain)
   |
   v
TransparentPass (linear HDR over)
   |
   v
User PostPosts (Bloom, GodRay, FXAA, ...) — all linear HDR
   |
   v
TonemapPost (ACES Filmic, single curve)         ← NEW, default-enabled
   |
   v
present quad → swapchain `bgra8unorm-srgb` view ← NEW, hardware encode
```

### New defaults (locked at "industry neutral")

| Setting | Default | Reasoning |
|---|---|---|
| `setting.render.tonemap.exposure` | `1.0` | Matches three.js `toneMappingExposure` and Filament neutral |
| `setting.render.tonemap.mode` | `'ACES'` | Matches three.js `ACESFilmicToneMapping` default |
| `setting.render.hdrExposure` | `1.0` | Was `1.5` (magic boost). With linear-HDR IBL retained, 1.0 is the physically correct neutral. |
| `setting.sky.skyExposure` | `1.0` | Unchanged; sample sky at full HDR |
| `setting.render.postProcessing.bloom.luminanceThreshole` | `1.0` | HDR luminance threshold (was effectively LDR-clamped before) |
| `setting.render.postProcessing.bloom.bloomIntensity` | `1.0` | Linear-additive bloom intensity |

These defaults are **not** tuned to match v1 visuals pixel-for-pixel.
They're tuned to be neutral starting points; per-scene tuning is
expected.

### Migrating your scenes

When you upgrade and a scene looks too bright or too dim, check
these knobs — they're the typical culprits:

#### Scene looks too bright (PBR materials, especially metallic)

Likely cause: light intensities sized for v1 LDR-compressed
intermediate paths now drive a fully-linear-HDR IBL.

```ts
// Halve direct light intensity if your v1 scene used > 5
lc.intensity = 5;        // was 10
lc.intensity = 1.5;      // was 3

// PBR material: env IBL contribution is now uncompressed HDR.
// Drop hdrExposure per-instance if needed:
engine.setting.render.hdrExposure = 0.7;   // dim env IBL only

// Or scale skyExposure — affects sky direct + IBL together:
engine.setting.sky.skyExposure = 0.7;

// Or pull tonemap exposure — global dimmer:
engine.setting.render.tonemap.exposure = 0.7;
```

#### Scene looks too dark (UnLit / Lambert / pure texture)

Likely cause: your color texture isn't being decoded — you loaded
it as `rgba8unorm` but the bytes are sRGB-encoded.

```ts
// If using engine.res.loadTexture, opt into sRGB:
let baseMap = await engine.res.loadTexture('color.png', null, undefined, 'srgb');
// or constructor:
let tex = new BitmapTexture2D(true, ctx, 'srgb');

// glTF auto-tags baseColor / emissive as 'srgb' — no action needed.
```

#### UnLit / Lambert / Sprite shows over-bright halo

Likely cause: shader-side `gammaToLiner` runs (correct) but you
also loaded the texture as `rgba8unorm-srgb` (hardware decode) →
double decode.

Set the `USE_SRGB_ALBEDO` define on the material:

```ts
material.shader.setDefine('USE_SRGB_ALBEDO', true);
```

#### Bloom looks subtler than v1

Linear-HDR bloom is mathematically subtler than the v1
`saturate(pow(...))` clamp. If you want the v1 punchy look:

```ts
let bloomPost = postProcessing.addPost(BloomPost);
bloomPost.bloomIntensity = 2.0;   // was effectively ~2x via the old saturate path
bloomPost.luminanceThreshole = 0.7;  // lower threshold to bloom more aggressively
```

#### Bloom doesn't fire at all on emissive

Your emissive value may be < 1.0 luminance. v1 bloom triggered
at lower thresholds because intermediate values were soft-clipped.
Linear-HDR bloom triggers based on actual HDR luminance:

```ts
mat.emissiveColor = new Color(1, 1, 0);
mat.emissiveIntensity = 2.0;   // pump above luminanceThreshole=1.0
```

### Color-space contracts

```ts
// Default — sRGB-encoded color texture, hardware-decoded on sample.
new BitmapTexture2D(true, ctx, 'srgb');
engine.res.loadTexture(url, null, undefined, 'srgb');

// Linear data — normal, AO, metallic-roughness, height, mask.
new BitmapTexture2D(true, ctx, 'linear');   // (also the default)
engine.res.loadTexture(url, null, undefined, 'linear');

// glTF loader auto-applies per channel:
//   baseColorTexture, emissiveTexture          → 'srgb'
//   normalTexture, metallicRoughnessTexture,
//   occlusionTexture, transmissionTexture,
//   thicknessTexture                           → 'linear'
```

### What's NOT a regression — accept the new look

These visual changes are correct under the new linear-HDR
pipeline; **don't** try to tune them back to v1 with magic numbers:

- IBL contributions on PBR surfaces are richer (full HDR retained)
- Specular highlights on metallic surfaces are sharper / brighter
- Sky reflections on mirror surfaces are at full HDR
- Bloom is linearly additive instead of `saturate(pow)`
- ACES smoothly compresses bright highlights instead of hard-clipping

### Compatibility flag (none)

This release intentionally ships **no `legacyMode` toggle**. The new
pipeline is the only correct one; "looking like v1" is a per-scene
asset tuning problem, not a renderer mode. If a scene is too bright
or too dim after migration, adjust the scene — not the renderer.
