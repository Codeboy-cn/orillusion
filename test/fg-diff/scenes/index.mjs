// Frame Graph pixel-diff scene manifest.
//
// Each entry defines a minimal scene known to exercise a distinct
// subset of the renderer so parity regressions surface early. Keep
// the list small — this is a smoke test for the migration, not a
// full sample suite.
//
// To add a scene:
//   1. Implement a `scene_<name>.ts` module under test/fg-diff/scenes/
//      that exports `default async function(engine, view) { ... }`
//      and populates a deterministic scene (fixed seeds, fixed clock).
//   2. Append the entry below with a short description of what it
//      covers.

export const scenes = [
    {
        name: 'cube_directional',
        description: 'Lit cube under one directional light. Baseline for CSM shadows + LitMaterial.',
        module: './scene_cube_directional.ts',
    },
    {
        name: 'cube_point',
        description: 'Lit cube under one point light. Baseline for point-light cube shadows.',
        module: './scene_cube_point.ts',
    },
    {
        name: 'gi_small_room',
        description: 'Closed room with emissive panel. Baseline for DDGI irradiance.',
        module: './scene_gi_small_room.ts',
    },
    {
        name: 'transparent_glass',
        description: 'Glass sphere in front of opaque cube. Baseline for sorted transparency.',
        module: './scene_transparent_glass.ts',
    },
    {
        name: 'post_bloom_taa',
        description: 'Bright emissive sphere with bloom + TAA enabled. Baseline for the post chain.',
        module: './scene_post_bloom_taa.ts',
    },
];

export function byName(name) {
    return scenes.find(s => s.name === name) ?? null;
}
