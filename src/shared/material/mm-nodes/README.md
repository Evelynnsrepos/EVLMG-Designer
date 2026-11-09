# Material Maker node files

These `.mmg` files are the node library of [Material Maker](https://github.com/RodZill4/material-maker) by
Rodolphe Suescun and contributors, under the MIT License ([`LICENSE.md`](LICENSE.md)). Material Lab loads them
unchanged and runs them with its own WebGL2 engine (`../gen.ts`, `../render.ts`, a TypeScript port of Material
Maker's shader generator).

- Copied from `addons/material_maker/nodes/` at commit `7d6daae3c74c09720afe4138ce09699ab3591ce1` (2026-10-24).
- Some nodes carry their own notice inside the file (MIT by Inigo Quilez, Garrett Gunnell, David Hoskins,
  fiveko.com; BSD 2-Clause by Michele Morrone in `denoiser*.mmg` and `hbao.mmg`). Those notices stay in the files.
- **Left out on purpose:** `skewed_bricks.mmg` (CC BY-SA 3.0), `skewed_uneven_bricks.mmg` (uses the code of
  `skewed_bricks`), `shard_fbm.mmg` and `voronoi_triangle.mmg` (adapted from Shadertoy shaders that name no licence).
  Don't add them back unless their licence is cleared.

To update: copy the folder again from a newer Material Maker commit, keep the four files above out, update the
commit here, and run `npm test` (the GPU test renders every node).
