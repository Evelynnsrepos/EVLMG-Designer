//! Mesh-map baking on every CPU core: the helper maps smart masks and wear are made from.
//! Each texel of the texture finds the spot of the model it covers (through the UVs) and looks
//! around from there with rays. The maps follow Material Painter's (`engine::MAPS`), baked here
//! on the CPU so they run the same on every computer, tablet and phone.

use crate::Mesh;
use crate::bvh::Bvh;
use crate::topology::Topology;
use glam::{Vec2, Vec3};
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Map {
    /// How much light from around reaches each spot: dark in corners and gaps.
    Occlusion,
    /// Small gaps only: seams, panel lines, engravings.
    Cavity,
    /// Edges bright, creases dark, flat mid grey.
    Curvature,
    /// How thick the model is behind each spot: dark where it's thin.
    Thickness,
    /// How much open sky each spot sees: where dust, snow and rain land.
    Sky,
    /// Bottom (dark) to top (bright) over the whole model.
    Height,
    /// One grey per loose part, for varying parts a little.
    PartRandom,
    /// Bright near sharp outer edges (within a few percent of the model's size).
    Edges,
    /// Bright near sharp inner creases.
    Creases,
}

impl Map {
    pub const ALL: [Map; 9] = [Map::Occlusion, Map::Cavity, Map::Curvature, Map::Thickness, Map::Sky, Map::Height, Map::PartRandom, Map::Edges, Map::Creases];

    pub fn key(self) -> &'static str {
        match self {
            Map::Occlusion => "occlusion",
            Map::Cavity => "cavity",
            Map::Curvature => "curvature",
            Map::Thickness => "thickness",
            Map::Sky => "sky",
            Map::Height => "height",
            Map::PartRandom => "part_random",
            Map::Edges => "edges",
            Map::Creases => "creases",
        }
    }

    pub fn from_key(key: &str) -> Option<Map> {
        Map::ALL.into_iter().find(|m| m.key() == key)
    }
}

/// How far edge wear and crease grime reach at most, as a share of the model's size.
const EDGE_WIDTH: f32 = 0.03;
/// Faces meeting at more than this angle (degrees) make a sharp edge.
const SHARP_ANGLE: f32 = 30.0;

/// The sharp edges of the model, as (outer edges, inner creases) segments with their object. Edges are found on the
/// welded surface of each object, so split normals and UV seams don't count.
fn sharp_edges(mesh: &Mesh) -> (Vec<Seg>, Vec<Seg>) {
    let weld = crate::weld_within_objects(mesh);
    let mut faces: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for t in 0..mesh.triangle_count() {
        for k in 0..3 {
            let (a, b) = (weld[mesh.indices[t * 3 + k] as usize], weld[mesh.indices[t * 3 + (k + 1) % 3] as usize]);
            faces.entry((a.min(b), a.max(b))).or_default().push(t);
        }
    }
    let normal = |t: usize| {
        let c = mesh.corners(t);
        (c[1] - c[0]).cross(c[2] - c[0]).normalize_or_zero()
    };
    let centre = |t: usize| mesh.corners(t).iter().sum::<Vec3>() / 3.0;
    let min_dot = SHARP_ANGLE.to_radians().cos();
    let (mut outer, mut inner) = (Vec::new(), Vec::new());
    for (&(a, b), tris) in &faces {
        let [t0, t1] = tris[..] else { continue };
        let (n0, n1) = (normal(t0), normal(t1));
        if n0.dot(n1) > min_dot {
            continue;
        }
        let (pa, pb) = (mesh.positions[a], mesh.positions[b]);
        // Convex when the other face falls away behind this one's front.
        let seg = Seg { ends: [pa, pb], object: mesh.tri_object.get(t0).copied().unwrap_or(0) };
        if (centre(t1) - (pa + pb) * 0.5).dot(n0) < 0.0 { outer.push(seg) } else { inner.push(seg) }
    }
    (outer, inner)
}

struct Seg {
    ends: [Vec3; 2],
    object: u32,
}

/// Line segments in a grid of cells as big as the longest distance asked for.
struct Segments {
    reach: f32,
    segs: Vec<Seg>,
    cells: HashMap<[i32; 3], Vec<u32>>,
}

impl Segments {
    fn new(segs: Vec<Seg>, reach: f32) -> Segments {
        let cell = |p: Vec3| (p / reach).floor().as_ivec3();
        let mut cells: HashMap<[i32; 3], Vec<u32>> = HashMap::new();
        for (i, Seg { ends: [a, b], .. }) in segs.iter().enumerate() {
            let (lo, hi) = (cell(a.min(*b)), cell(a.max(*b)));
            for x in lo.x..=hi.x {
                for y in lo.y..=hi.y {
                    for z in lo.z..=hi.z {
                        cells.entry([x, y, z]).or_default().push(i as u32);
                    }
                }
            }
        }
        Segments { reach, segs, cells }
    }

    /// Distance to the nearest segment of `object` (an edge of the crate doesn't wear the floor it stands on), at most `reach`.
    fn nearest(&self, p: Vec3, object: u32) -> f32 {
        let c = (p / self.reach).floor().as_ivec3();
        let mut best = self.reach;
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    for &i in self.cells.get(&[c.x + dx, c.y + dy, c.z + dz]).map_or(&[][..], |v| &v[..]) {
                        let seg = &self.segs[i as usize];
                        if seg.object != object {
                            continue;
                        }
                        let [a, b] = seg.ends;
                        let ab = b - a;
                        let t = ((p - a).dot(ab) / ab.length_squared().max(1e-12)).clamp(0.0, 1.0);
                        best = best.min(p.distance(a + ab * t));
                    }
                }
            }
        }
        best
    }
}

/// Rays per texel: enough for smooth maps at game texture sizes in a few seconds.
const RAYS: usize = 32;
/// Texels of padding grown past every UV island's edge, so seams don't show on the model.
const PADDING: usize = 4;

/// What each covered texel sees of the model.
struct Sample {
    pos: Vec3,
    normal: Vec3,
    /// Curvature, already from -1 (crease) to 1 (edge).
    curve: f32,
    /// The loose part it is on.
    part: u32,
    /// The object of the file it is on.
    object: u32,
}

/// One model at one texture size: the texels' spots on the model, and every map baked so far, kept
/// so wear masks can be tried again and again without baking twice.
pub struct Baker {
    size: usize,
    samples: Vec<Option<Sample>>,
    bvh: Bvh,
    lo: Vec3,
    hi: Vec3,
    planes: Mutex<HashMap<Map, Arc<Vec<f32>>>>,
    /// Sharp outer edges and inner creases, for `Map::Edges` and `Map::Creases`.
    edges: Segments,
    creases: Segments,
}

impl Baker {
    pub fn new(mesh: &Mesh, size: u32) -> Baker {
        let size = size.clamp(16, 4096) as usize;
        let topo = Topology::build(mesh);
        let (lo, hi) = mesh.positions.iter().fold((Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)), |(lo, hi), p| (lo.min(*p), hi.max(*p)));
        let reach = (hi - lo).length().max(1e-6) * EDGE_WIDTH;
        let (edges, creases) = sharp_edges(mesh);
        Baker {
            size,
            samples: rasterize(mesh, size, &topo),
            bvh: Bvh::from_mesh(mesh),
            lo,
            hi,
            planes: Mutex::default(),
            edges: Segments::new(edges, reach),
            creases: Segments::new(creases, reach),
        }
    }

    pub fn size(&self) -> u32 {
        self.size as u32
    }

    /// One map, 0..1 per texel (0 off the model), baked once.
    fn plane(&self, map: Map) -> Arc<Vec<f32>> {
        if let Some(p) = self.planes.lock().unwrap_or_else(|e| e.into_inner()).get(&map) {
            return p.clone();
        }
        let (bvh, lo, hi) = (&self.bvh, self.lo, self.hi);
        let diag = (hi - lo).length().max(1e-6);
        let eps = diag * 2e-4;
        let dirs = hemisphere(RAYS);
        let value = |i: usize, s: &Sample| -> f32 {
            let o = s.pos + s.normal * eps;
            // A different turn of the ray pattern per texel hides banding.
            let turn = hash(i as u32) * std::f32::consts::TAU;
            match map {
                Map::Occlusion => 1.0 - blocked(bvh, o, s.normal, &dirs, turn, diag * 0.25),
                Map::Cavity => 1.0 - blocked(bvh, o, s.normal, &dirs[..RAYS / 2], turn, diag * 0.02),
                Map::Curvature => 0.5 + 0.5 * s.curve,
                Map::Thickness => {
                    let reach = diag * 0.25;
                    let inside = s.pos - s.normal * eps;
                    let sum: f32 = dirs.iter().map(|&d| bvh.raycast(inside, -frame(s.normal, d, turn)).map_or(reach, |h| h.pos.distance(inside).min(reach))).sum();
                    sum / (dirs.len() as f32 * reach)
                }
                Map::Sky => {
                    // Rays around straight up; those going into the surface are blocked by it.
                    let open = dirs
                        .iter()
                        .filter(|&&d| {
                            let d = frame(Vec3::Y, d, turn);
                            d.dot(s.normal) > 0.0 && !bvh.occluded(o, d, f32::MAX)
                        })
                        .count();
                    open as f32 / dirs.len() as f32
                }
                Map::Height => (s.pos.y - lo.y) / (hi.y - lo.y).max(1e-6),
                Map::PartRandom => hash(s.part ^ 0x9e37_79b9),
                Map::Edges => 1.0 - self.edges.nearest(s.pos, s.object) / self.edges.reach,
                Map::Creases => 1.0 - self.creases.nearest(s.pos, s.object) / self.creases.reach,
            }
        };
        let plane: Arc<Vec<f32>> = Arc::new(self.samples.par_iter().enumerate().map(|(i, s)| s.as_ref().map_or(0.0, |s| value(i, s).clamp(0.0, 1.0))).collect());
        self.planes.lock().unwrap_or_else(|e| e.into_inner()).insert(map, plane.clone());
        plane
    }

    /// `maps` as grey bytes (in order), then the coverage (255 on the islands and their padding).
    pub fn bake(&self, maps: &[Map]) -> Vec<Vec<u8>> {
        let mut out: Vec<Vec<u8>> = maps.iter().map(|&m| to_bytes(&self.plane(m))).collect();
        self.finish(&mut out);
        out
    }

    /// A wear mask: white where `kind` puts wear. `amount` 0..1 (more wear), `breakup` 0..1 (how much
    /// noise breaks the edge up), `seed` picks another noise pattern. Grey bytes, then the coverage.
    pub fn wear(&self, kind: Wear, amount: f32, breakup: f32, seed: u32) -> Vec<Vec<u8>> {
        let need = kind.maps();
        let planes: Vec<Arc<Vec<f32>>> = need.iter().map(|&m| self.plane(m)).collect();
        let diag = (self.hi - self.lo).length().max(1e-6);
        let breakup = breakup.clamp(0.0, 1.0);
        // 0 leaves even the strongest, noisiest spots clean, 1 covers the whole model (the soft edge is 0.06 wide).
        let reach = 1.07 + 0.45 * breakup;
        let threshold = reach - amount.clamp(0.0, 1.0) * (2.0 * reach - 1.0);
        let offset = Vec3::new(hash(seed), hash(seed ^ 0x51ed_270b), hash(seed ^ 0x2545_f491)) * 97.0;
        let mask: Vec<u8> = self
            .samples
            .par_iter()
            .enumerate()
            .map(|(i, s)| {
                let Some(s) = s else { return 0 };
                let p = (s.pos - self.lo) / diag;
                let raw = kind.signal(&|k| planes[k][i], s.normal, p + offset).clamp(0.0, 1.0);
                let n = fbm(p * 12.0 + offset, 4) - 0.5;
                let v = raw + n * breakup * 0.9;
                (smoothstep(threshold - 0.06, threshold + 0.06, v) * 255.0).round() as u8
            })
            .collect();
        let mut out = vec![mask];
        self.finish(&mut out);
        out
    }

    /// Padding past the islands, then the coverage plane.
    fn finish(&self, out: &mut Vec<Vec<u8>>) {
        let mut covered: Vec<bool> = self.samples.iter().map(Option::is_some).collect();
        dilate(out, &mut covered, self.size);
        out.push(covered.iter().map(|&c| if c { 255 } else { 0 }).collect());
    }
}

/// Bakes `maps` at `size` × `size`. Returns one grey byte per texel for each map (in order), and
/// last a coverage byte per texel (255 on the model's UV islands and their padding, 0 elsewhere).
pub fn bake(mesh: &Mesh, size: u32, maps: &[Map]) -> Vec<Vec<u8>> {
    Baker::new(mesh, size).bake(maps)
}

fn to_bytes(plane: &[f32]) -> Vec<u8> {
    plane.iter().map(|v| (v * 255.0).round() as u8).collect()
}

/// Where wear and dirt go, from the shape maps (Material Painter's smart mask generators).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Wear {
    /// Paint rubbed off sharp outer edges.
    EdgeWear,
    /// Grime collected in corners and gaps.
    Dirt,
    /// Dust settled on surfaces facing up and open to the sky.
    Dust,
    /// Long marks running down the sides where rain falls.
    RainStreaks,
    /// Thin runs down the steep sides.
    Drips,
    /// Dark grime in small seams and engravings only.
    CavityGrime,
    /// Grime along inner creases.
    CreaseGrime,
    /// Thin parts (ears, leaves, cloth edges) for see-through or a glow.
    ThinAreas,
}

impl Wear {
    pub const ALL: [Wear; 8] = [Wear::EdgeWear, Wear::Dirt, Wear::Dust, Wear::RainStreaks, Wear::Drips, Wear::CavityGrime, Wear::CreaseGrime, Wear::ThinAreas];

    pub fn key(self) -> &'static str {
        match self {
            Wear::EdgeWear => "edge_wear",
            Wear::Dirt => "dirt",
            Wear::Dust => "dust",
            Wear::RainStreaks => "rain_streaks",
            Wear::Drips => "drips",
            Wear::CavityGrime => "cavity_grime",
            Wear::CreaseGrime => "crease_grime",
            Wear::ThinAreas => "thin_areas",
        }
    }

    pub fn from_key(key: &str) -> Option<Wear> {
        Wear::ALL.into_iter().find(|w| w.key() == key)
    }

    fn maps(self) -> &'static [Map] {
        match self {
            Wear::EdgeWear => &[Map::Edges, Map::Curvature],
            Wear::CreaseGrime => &[Map::Creases, Map::Curvature],
            Wear::Dirt => &[Map::Occlusion, Map::Cavity],
            Wear::Dust | Wear::RainStreaks => &[Map::Sky],
            Wear::Drips => &[Map::Occlusion],
            Wear::CavityGrime => &[Map::Cavity],
            Wear::ThinAreas => &[Map::Thickness],
        }
    }

    /// How strongly wear belongs here, about 0..1; `map(k)` is the k-th of `maps()` at this texel.
    fn signal(self, map: &dyn Fn(usize) -> f32, n: Vec3, p: Vec3) -> f32 {
        // Noise stretched straight down: streaks and drips.
        let streaks = |sharp: f32| (fbm(Vec3::new(p.x * 60.0, p.y * 3.0, p.z * 60.0), 3) - 0.5) * sharp + 0.5;
        let side = 1.0 - n.y.abs();
        match self {
            // Near a sharp edge, plus a little on rounded edges.
            Wear::EdgeWear => map(0) * 1.1 + ((map(1) - 0.5) * 2.0).max(0.0) * 0.5,
            Wear::CreaseGrime => map(0) * 1.1 + ((0.5 - map(1)) * 2.0).max(0.0) * 0.5,
            Wear::Dirt => (1.0 - map(0)) * 0.7 + (1.0 - map(1)) * 0.6,
            Wear::Dust => map(0) * n.y.max(0.0) * 1.1,
            Wear::RainStreaks => map(0).powf(0.5) * side * streaks(1.8),
            Wear::Drips => side * smoothstep(0.55, 0.75, streaks(2.6)) * (1.2 - map(0) * 0.4),
            Wear::CavityGrime => (1.0 - map(0)) * 1.8,
            Wear::ThinAreas => (1.0 - map(0)) * 1.2,
        }
    }
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Smooth 3D value noise, a few octaves, about 0..1.
fn fbm(p: Vec3, octaves: u32) -> f32 {
    let (mut sum, mut amp, mut norm, mut q) = (0.0, 0.5, 0.0, p);
    for _ in 0..octaves {
        sum += value_noise(q) * amp;
        norm += amp;
        amp *= 0.5;
        q *= 2.03;
    }
    sum / norm
}

fn value_noise(p: Vec3) -> f32 {
    let i = p.floor();
    let f = p - i;
    let u = f * f * (Vec3::splat(3.0) - 2.0 * f);
    let at = |dx: i32, dy: i32, dz: i32| {
        let (x, y, z) = (i.x as i32 + dx, i.y as i32 + dy, i.z as i32 + dz);
        hash((x as u32).wrapping_mul(73_856_093) ^ (y as u32).wrapping_mul(19_349_663) ^ (z as u32).wrapping_mul(83_492_791))
    };
    let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
    let x00 = lerp(at(0, 0, 0), at(1, 0, 0), u.x);
    let x10 = lerp(at(0, 1, 0), at(1, 1, 0), u.x);
    let x01 = lerp(at(0, 0, 1), at(1, 0, 1), u.x);
    let x11 = lerp(at(0, 1, 1), at(1, 1, 1), u.x);
    lerp(lerp(x00, x10, u.y), lerp(x01, x11, u.y), u.z)
}

/// The share of `dirs` (turned onto the normal) that hit the model within `reach`.
fn blocked(bvh: &Bvh, o: Vec3, n: Vec3, dirs: &[Vec3], turn: f32, reach: f32) -> f32 {
    dirs.iter().filter(|&&d| bvh.occluded(o, frame(n, d, turn), reach)).count() as f32 / dirs.len() as f32
}

/// The model spot under the centre of each texel (none where no UV island covers it).
fn rasterize(mesh: &Mesh, size: usize, topo: &Topology) -> Vec<Option<Sample>> {
    let curve = vertex_curvature(mesh);
    let mut out: Vec<Option<Sample>> = (0..size * size).map(|_| None).collect();
    let s = size as f32;
    for t in 0..mesh.triangle_count() {
        let idx = [0, 1, 2].map(|k| mesh.indices[t * 3 + k] as usize);
        let uv = idx.map(|i| mesh.uvs[i] * s);
        let area = (uv[1] - uv[0]).perp_dot(uv[2] - uv[0]);
        if area.abs() < 1e-12 {
            continue;
        }
        let lo = uv[0].min(uv[1]).min(uv[2]).floor().max(Vec2::ZERO);
        let hi = uv[0].max(uv[1]).max(uv[2]).ceil().min(Vec2::splat(s));
        for y in lo.y as usize..hi.y as usize {
            for x in lo.x as usize..hi.x as usize {
                let p = Vec2::new(x as f32 + 0.5, y as f32 + 0.5);
                let w1 = (p - uv[0]).perp_dot(uv[2] - uv[0]) / area;
                let w2 = (uv[1] - uv[0]).perp_dot(p - uv[0]) / area;
                let w0 = 1.0 - w1 - w2;
                if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                    continue;
                }
                let w = [w0, w1, w2];
                let mix3 = |v: &dyn Fn(usize) -> Vec3| v(idx[0]) * w[0] + v(idx[1]) * w[1] + v(idx[2]) * w[2];
                let pos = mix3(&|i| mesh.positions[i]);
                let normal = mix3(&|i| mesh.normals[i]).try_normalize().unwrap_or_else(|| {
                    let c = mesh.corners(t);
                    (c[1] - c[0]).cross(c[2] - c[0]).normalize_or(Vec3::Y)
                });
                let curve = curve[idx[0]] * w[0] + curve[idx[1]] * w[1] + curve[idx[2]] * w[2];
                out[y * size + x] = Some(Sample { pos, normal, curve, part: topo.part_of(t).0, object: mesh.tri_object.get(t).copied().unwrap_or(0) });
            }
        }
    }
    out
}

/// Per vertex: how much the surface bends away (positive, an edge) or in (negative, a crease),
/// from the smoothed normals of its welded neighbours, squashed into -1..1.
fn vertex_curvature(mesh: &Mesh) -> Vec<f32> {
    let weld = crate::weld_within_objects(mesh);
    let mut smooth = vec![Vec3::ZERO; mesh.positions.len()];
    for (i, &w) in weld.iter().enumerate() {
        smooth[w] += mesh.normals[i];
    }
    let n = |i: usize| smooth[weld[i]].normalize_or_zero();
    let (mut sum, mut count) = (vec![0.0f32; mesh.positions.len()], vec![0u32; mesh.positions.len()]);
    for t in mesh.indices.chunks_exact(3) {
        for k in 0..3 {
            let (a, b) = (t[k] as usize, t[(k + 1) % 3] as usize);
            let d = mesh.positions[b] - mesh.positions[a];
            let len2 = d.length_squared();
            if len2 < 1e-12 {
                continue;
            }
            // Normals spreading apart along an edge: a sphere of radius r gives 1/r.
            let c = (n(b) - n(a)).dot(d) / len2;
            for v in [weld[a], weld[b]] {
                sum[v] += c;
                count[v] += 1;
            }
        }
    }
    let (lo, hi) = mesh.positions.iter().fold((Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)), |(lo, hi), p| (lo.min(*p), hi.max(*p)));
    let diag = (hi - lo).length().max(1e-6);
    // shortcut: one fixed scale for every model (a sphere comes out a little bright), make it a slider with the smart masks step.
    (0..mesh.positions.len()).map(|i| (sum[weld[i]] / count[weld[i]].max(1) as f32 * diag / 12.0).tanh()).collect()
}

/// Grows every map `PADDING` texels past the islands, each new texel the average of its covered neighbours.
fn dilate(maps: &mut [Vec<u8>], covered: &mut [bool], size: usize) {
    for _ in 0..PADDING {
        let before = covered.to_vec();
        let mut grown = Vec::new();
        for y in 0..size {
            for x in 0..size {
                if before[y * size + x] {
                    continue;
                }
                let near: Vec<usize> = [(-1i32, 0i32), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)]
                    .iter()
                    .filter_map(|&(dx, dy)| {
                        let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                        (nx >= 0 && ny >= 0 && (nx as usize) < size && (ny as usize) < size).then(|| ny as usize * size + nx as usize)
                    })
                    .filter(|&j| before[j])
                    .collect();
                if !near.is_empty() {
                    grown.push((y * size + x, near));
                }
            }
        }
        for (i, near) in grown {
            for m in maps.iter_mut() {
                m[i] = (near.iter().map(|&j| m[j] as u32).sum::<u32>() / near.len() as u32) as u8;
            }
            covered[i] = true;
        }
    }
}

/// `n` directions over the hemisphere around +Z, spread evenly (spherical Fibonacci) and
/// cosine-weighted, so occlusion counts like light does.
fn hemisphere(n: usize) -> Vec<Vec3> {
    let golden = std::f32::consts::PI * (3.0 - 5f32.sqrt());
    (0..n)
        .map(|i| {
            let r = ((i as f32 + 0.5) / n as f32).sqrt();
            let a = i as f32 * golden;
            Vec3::new(r * a.cos(), r * a.sin(), (1.0 - r * r).max(0.0).sqrt())
        })
        .collect()
}

/// Direction `d` (around +Z) turned by `turn` and set onto the normal `n`.
fn frame(n: Vec3, d: Vec3, turn: f32) -> Vec3 {
    let (s, c) = turn.sin_cos();
    let (t, b) = n.any_orthonormal_pair();
    // The turn rotates the tangent pair instead of every direction.
    let (t, b) = (t * c + b * s, b * c - t * s);
    (t * d.x + b * d.y + n * d.z).normalize()
}

/// A number from 0 to 1 that looks random but is always the same for the same input.
fn hash(mut x: u32) -> f32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x as f32 / u32::MAX as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shapes;

    fn at(map: &[u8], size: usize, uv: Vec2) -> u8 {
        let p = (uv * size as f32).as_uvec2();
        map[p.y as usize * size + p.x as usize]
    }

    #[test]
    fn keys_round_trip() {
        for m in Map::ALL {
            assert_eq!(Map::from_key(m.key()), Some(m));
        }
    }

    #[test]
    fn a_floor_under_a_cylinder_is_darker_next_to_it() {
        // A cylinder standing on a big floor: the floor next to its foot gets less light than far away.
        let mut m = shapes::plane(20);
        for p in &mut m.positions {
            *p *= 4.0;
        }
        // The floor's UVs fill the left half, the cylinder's the right half.
        for uv in &mut m.uvs {
            uv.x *= 0.5;
        }
        let c = shapes::cylinder(24, 4);
        let off = m.positions.len() as u32;
        m.positions.extend(c.positions.iter().map(|p| *p * 0.5 + Vec3::new(0.0, 0.5, 0.0)));
        m.normals.extend(c.normals.iter().copied());
        m.uvs.extend(c.uvs.iter().map(|uv| Vec2::new(0.5 + uv.x * 0.5, uv.y)));
        m.indices.extend(c.indices.iter().map(|i| i + off));
        m.tri_object.extend(std::iter::repeat_n(1, c.triangle_count()));
        let n = m.triangle_count() as u32;
        m.sets = vec![0..n];
        let size = 128;
        let maps = bake(&m, size, &[Map::Occlusion, Map::Height, Map::Sky, Map::PartRandom]);
        assert_eq!(maps.len(), 5, "four maps and the coverage");
        assert!(maps.iter().all(|m| m.len() == (size * size) as usize));
        // Floor UV (u from 0 to 0.5) maps to x from -4 to 4: the foot is at the middle, u = 0.25.
        let ao = &maps[0];
        let near = at(ao, size as usize, Vec2::new(0.25 + 0.5 * 0.6 / 8.0, 0.5));
        let far = at(ao, size as usize, Vec2::new(0.02, 0.02));
        assert!(near + 30 < far, "next to the cylinder {near} vs far away {far}");
        // Height: the floor is the bottom, the cylinder's top is the top.
        assert!(at(&maps[1], size as usize, Vec2::new(0.02, 0.02)) < 10);
        // Sky: the open floor sees nearly all of the sky.
        assert!(at(&maps[2], size as usize, Vec2::new(0.02, 0.02)) > 230);
        // Two loose parts, two different greys.
        assert_ne!(at(&maps[3], size as usize, Vec2::new(0.1, 0.1)), at(&maps[3], size as usize, Vec2::new(0.75, 0.75)));
        // Coverage: on the islands and a little padding, not everywhere.
        let cov = &maps[4];
        let covered = cov.iter().filter(|&&c| c == 255).count();
        assert!(covered > (size * size / 3) as usize && covered < (size * size) as usize);
    }

    #[test]
    fn curvature_sees_the_rim_of_a_cylinder() {
        // Where the side meets a cap the averaged normals turn: a convex edge, brighter than the middle of the side.
        let m = shapes::cylinder(32, 8);
        let size = 128;
        let maps = bake(&m, size, &[Map::Curvature, Map::Thickness]);
        let side_middle = at(&maps[0], size as usize, Vec2::new(0.3, 0.75));
        let side_rim = at(&maps[0], size as usize, Vec2::new(0.3, 0.995));
        assert!(side_rim > side_middle + 5, "rim {side_rim} vs middle {side_middle}");
        // The side of a closed cylinder isn't thin.
        assert!(at(&maps[1], size as usize, Vec2::new(0.3, 0.75)) > 100);
    }
}

/// `cargo test --release -p texpaint bake_speed -- --ignored --nocapture`: time a 1024² bake of a ~70k-triangle model.
#[cfg(test)]
mod speed {
    use super::*;

    #[test]
    #[ignore]
    fn bake_speed() {
        let m = crate::shapes::cylinder(256, 128);
        let start = std::time::Instant::now();
        let maps = bake(&m, 1024, &Map::ALL);
        println!("{} triangles, {} maps at 1024²: {:?} on {} threads", m.triangle_count(), maps.len() - 1, start.elapsed(), rayon::current_num_threads());
    }
}

#[cfg(test)]
mod wear_tests {
    use super::*;
    use crate::shapes;

    #[test]
    fn keys_round_trip() {
        for w in Wear::ALL {
            assert_eq!(Wear::from_key(w.key()), Some(w));
        }
    }

    #[test]
    fn edge_wear_sits_on_the_rim_and_amount_and_seed_work() {
        let m = shapes::cylinder(32, 8);
        let size = 128usize;
        let b = Baker::new(&m, size as u32);
        let at = |mask: &[u8], u: f32, v: f32| mask[(v * size as f32) as usize * size + (u * size as f32) as usize];
        let mask = &b.wear(Wear::EdgeWear, 0.5, 0.0, 1)[0];
        assert!(at(mask, 0.3, 0.995) > 200, "worn on the rim: {}", at(mask, 0.3, 0.995));
        assert!(at(mask, 0.3, 0.75) < 30, "clean in the middle of the side: {}", at(mask, 0.3, 0.75));
        // No wear at all, and wear everywhere on the model.
        assert!(b.wear(Wear::EdgeWear, 0.0, 0.5, 1)[0].iter().all(|&v| v < 10));
        let full = &b.wear(Wear::Dirt, 1.0, 0.0, 1);
        let on_model = full[1].iter().filter(|&&c| c == 255).count();
        let white = full[0].iter().zip(&full[1]).filter(|&(&v, &c)| c == 255 && v > 200).count();
        assert!(white * 10 > on_model * 9, "{white} of {on_model}");
        // Another seed, another break-up pattern; the same seed, the same mask.
        let a = &b.wear(Wear::Dirt, 0.9, 1.0, 1)[0];
        assert_eq!(a, &b.wear(Wear::Dirt, 0.9, 1.0, 1)[0]);
        assert_ne!(a, &b.wear(Wear::Dirt, 0.9, 1.0, 2)[0]);
        // Dust lands on the top cap (facing up), not on the bottom one.
        let dust = &b.wear(Wear::Dust, 0.5, 0.0, 1)[0];
        assert!(at(dust, 0.75, 0.25) > 200 && at(dust, 0.25, 0.25) < 30, "top {} bottom {}", at(dust, 0.75, 0.25), at(dust, 0.25, 0.25));
    }

    #[test]
    fn sharp_edges_and_touching_objects() {
        // The cylinder's rim is a 90 degree outer edge; the middle of the side is far from any.
        let m = shapes::cylinder(32, 8);
        let size = 128usize;
        let maps = bake(&m, size as u32, &[Map::Edges, Map::Creases]);
        let at = |p: &[u8], u: f32, v: f32| p[(v * size as f32) as usize * size + (u * size as f32) as usize];
        assert!(at(&maps[0], 0.3, 0.995) > 200 && at(&maps[0], 0.3, 0.75) < 20);
        assert!(maps[1].iter().all(|&v| v < 5), "a cylinder has no inner creases");
        // A floor plane touching the cylinder's bottom (another object) leaves its curvature alone.
        let (lone, _) = sharp_edges(&m);
        let mut both = shapes::cylinder(32, 8);
        let f = shapes::plane(4);
        let off = both.positions.len() as u32;
        both.positions.extend(f.positions.iter().map(|p| *p - Vec3::Y));
        both.normals.extend(f.normals.iter().copied());
        both.uvs.extend(f.uvs.iter().copied());
        both.indices.extend(f.indices.iter().map(|i| i + off));
        both.tri_object.extend(std::iter::repeat_n(1, f.triangle_count()));
        assert_eq!(sharp_edges(&both).0.len(), lone.len(), "no new edges where the objects touch");
    }

    #[test]
    fn maps_are_baked_once() {
        let b = Baker::new(&shapes::cylinder(8, 2), 32);
        let first = b.plane(Map::Occlusion);
        assert!(Arc::ptr_eq(&first, &b.plane(Map::Occlusion)));
    }
}
