# Material Lab: node engine notes

> **Experimental.** Material Lab is work in progress on the `feat/material-lab` branch. Nothing here is in a release
> yet, there is no screen for it, and its code and file format can still change.

Material Lab builds tiling textures from nodes. Plan: `plans/material-lab-plan.md`, `plans/material-maker-integration.md`
and `plans/material-lab-ux-plan.md` in the project files. This file covers what is built so far.

## Build 1: node engine (no screen yet)

Code in `src/shared/material/`:

| File | What it does |
|---|---|
| `mm-nodes/` | Material Maker's `.mmg` node files (MIT), see its `README.md` for the source commit and the 4 nodes left out |
| `library.ts` | Loads the node files, lists the usable nodes (`listNodes()`), says why a node is left out (`unsupportedReason()`) |
| `gen.ts` | Port of Material Maker's shader generator: shader nodes, graphs, inputs/outputs, remotes, switches, buffers, iterate buffers |
| `render.ts` | WebGL2 renderer: one render pass per buffer (cached until its shader, values or inputs change), 16-bit float textures with an 8-bit fallback |
| `nodeCheck.ts` | Test helper: puts a node in a small graph with test pictures on its inputs and measures if the result tiles |

How a node becomes a picture: `gen.getShaderCode('uv', output, new GenContext())` gives GLSL pieces,
`fragmentSource()` turns them into a WebGL2 shader, and `new MaterialRenderer().render(gen, output, size)` runs it
(plus every buffer it needs) and returns RGBA floats, row 0 at the top.

### What runs and what doesn't yet

- **380 of the 395 bundled nodes run**, 76 of them 3D shapes and 3D textures, shown as a lit shape or a textured
  ball (Material Maker's own preview shaders, `preview3d.ts`). Polygon, polyline, splines, pixels and lattice
  parameters work (their editors come with the screens). Left out: 7 material output nodes (Material Lab gets its
  own outputs), 6 nodes that need a 3D model or scene (mesh maps, triplanar brushes, raymarching preview), and
  `bricks_nontileable`, which is written for an older bricks node and is broken in Material Maker itself.
- **Godot to WebGL:** `godot.ts` rewrites the few things Godot's shader language allows and WebGL2 doesn't
  (`{ … }` array initialisers, whole numbers passed where a float is expected).
- **Tiling:** every 2D node tiles except 19 are gradients, centred shapes and fill helpers, listed with reasons in
  `gpu.test.ts`. Material Maker's nodes look like Material Maker's, not like any other app's.
- **Tests:** `gen.test.ts` builds the shader of every included node without a GPU. `gpu.test.ts` compiles and
  renders every included node in headless Chrome/Chromium (small buffers and at most 8 loop rounds, to stay fast on a software GPU) and checks that the picture tiles (3D previews are one object, so they only have to render cleanly); it is skipped when no
  browser is found, and CI sets `MATERIAL_GPU_TEST=required` so it can't be skipped there.
- **Screens (build 2 and 3, `src/components/material/`):** the `material` document (see `docs/FORMAT.md`), a gallery
  of 31 of Material Maker's example materials (`shared/material/examples/`), the lit preview (`preview.ts`: ball,
  3×3 tiled floor, 64 px pixel-art tile, five light presets, one map at a time), the Simple view (Material node
  sliders, "Surprise me" = Material Maker's variation) and PNG map export, plus the Graph view (`GraphView.tsx`:
  move, connect, add nodes by search, float/enum/size/boolean/colour settings, node pictures).
- Not built yet: the Layers view, editors for gradient/curve/polygon/spline/pixel settings, Godot material export,
  own 3D model in the preview, before/after slider, frames and comments in the graph, pinch zoom. Those are builds 2 to 4.

## Mobile app

All of this is shared desktop code, so the mobile app gets it with a submodule bump. It is plain WebGL2, so it runs in
the iOS and Android web views; phones without float render targets fall back to 8-bit textures
(`MaterialRenderer.floatTextures` tells which).

The project format does **not** change in build 1. Build 2 adds a new document type `material` (the graph as JSON,
textures are rebuilt on each device). That addition must be additive: older desktop versions and the current mobile
app skip the unknown type cleanly, and the mobile repo's `src/compat.test.ts` gets a fixture for it when it lands.
Keep this note and `docs/MOBILE-TOOLS.md` in the mobile repo in sync.
