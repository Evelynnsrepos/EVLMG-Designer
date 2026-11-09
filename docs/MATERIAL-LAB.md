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

- **299 of the 395 bundled nodes run.** Left out for now: 76 3D-only nodes (3D shapes and 3D textures), 7 material
  output nodes (Material Lab gets its own outputs), 5 nodes that need a 3D model or scene (mesh maps, triplanar brush,
  raymarching preview), 6 nodes whose parameters need an editor first (polygon, polyline, splines, pixels, lattice),
  and `bricks_nontileable`, which is broken in Material Maker itself.
- **Godot to WebGL:** `godot.ts` rewrites the few things Godot's shader language allows and WebGL2 doesn't
  (`{ … }` array initialisers, whole numbers passed where a float is expected).
- **Tiling:** 280 nodes tile. The 19 that don't are gradients, centred shapes and fill helpers, listed with reasons in
  `gpu.test.ts`. Material Maker's nodes look like Material Maker's, not like any other app's.
- **Tests:** `gen.test.ts` builds the shader of every included node without a GPU. `gpu.test.ts` compiles and
  renders every included node in headless Chrome/Chromium (small buffers and at most 8 loop rounds, to stay fast on a software GPU) and checks that the picture tiles; it is skipped when no
  browser is found, and CI sets `MATERIAL_GPU_TEST=required` so it can't be skipped there.
- Not built yet: the document type, screens, 3D preview, export. Those are builds 2 to 4.

## Mobile app

All of this is shared desktop code, so the mobile app gets it with a submodule bump. It is plain WebGL2, so it runs in
the iOS and Android web views; phones without float render targets fall back to 8-bit textures
(`MaterialRenderer.floatTextures` tells which).

The project format does **not** change in build 1. Build 2 adds a new document type `material` (the graph as JSON,
textures are rebuilt on each device). That addition must be additive: older desktop versions and the current mobile
app skip the unknown type cleanly, and the mobile repo's `src/compat.test.ts` gets a fixture for it when it lands.
Keep this note and `docs/MOBILE-TOOLS.md` in the mobile repo in sync.
