//! Mesh-map baking on every CPU core: the helper maps smart masks and wear are made from.
//! Each texel of the texture finds the spot of the model it covers (through the UVs) and looks
//! around from there with rays. The maps follow Material Painter's (`engine::MAPS`), baked here
//! on the CPU so they run the same on every computer, tablet and phone.

use crate::Mesh;
use crate::bvh::Bvh;
use crate::topology::Topology;
use glam::{Vec2, Vec3};
use rayon::prelude::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
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
}

impl Map {
    pub const ALL: [Map; 7] = [Map::Occlusion, Map::Cavity, Map::Curvature, Map::Thickness, Map::Sky, Map::Height, Map::PartRandom];

    pub fn key(self) -> &'static str {
        match self {
            Map::Occlusion => "occlusion",
            Map::Cavity => "cavity",
            Map::Curvature => "curvature",
            Map::Thickness => "thickness",
            Map::Sky => "sky",
            Map::Height => "height",
            Map::PartRandom => "part_random",
        }
    }

    pub fn from_key(key: &str) -> Option<Map> {
        Map::ALL.into_iter().find(|m| m.key() == key)
    }
}

/// Rays per texel: enough for smooth maps at game texture sizes in a few seconds.
const RAYS: usize = 32;
/// Texels of padding grown past every UV island's edge, so seams don't show on the model.
const PADDING: usize = 4;

/// What each covered texel sees of the model.
struct Sample {
    tri: u32,
    pos: Vec3,
    normal: Vec3,
    /// Curvature, already from -1 (crease) to 1 (edge).
    curve: f32,
}

/// Bakes `maps` at `size` × `size`. Returns one grey byte per texel for each map (in order), and
/// last a coverage byte per texel (255 on the model's UV islands and their padding, 0 elsewhere).
pub fn bake(mesh: &Mesh, size: u32, maps: &[Map]) -> Vec<Vec<u8>> {
    let size = size.clamp(16, 4096) as usize;
    let samples = rasterize(mesh, size);
    let bvh = Bvh::from_mesh(mesh);
    let (lo, hi) = mesh.positions.iter().fold((Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)), |(lo, hi), p| (lo.min(*p), hi.max(*p)));
    let diag = (hi - lo).length().max(1e-6);
    let eps = diag * 2e-4;
    let dirs = hemisphere(RAYS);
    let topo = maps.contains(&Map::PartRandom).then(|| Topology::build(mesh));

    let mut out: Vec<Vec<u8>> = maps
        .iter()
        .map(|&map| {
            let value = |i: usize, s: &Sample| -> f32 {
                let o = s.pos + s.normal * eps;
                // A different turn of the ray pattern per texel hides banding.
                let turn = hash(i as u32) * std::f32::consts::TAU;
                match map {
                    Map::Occlusion => 1.0 - blocked(&bvh, o, s.normal, &dirs, turn, diag * 0.25),
                    Map::Cavity => 1.0 - blocked(&bvh, o, s.normal, &dirs[..RAYS / 2], turn, diag * 0.02),
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
                    Map::PartRandom => topo.as_ref().map_or(0.5, |t| hash(t.part_of(s.tri as usize).0 ^ 0x9e37_79b9)),
                }
            };
            samples.par_iter().enumerate().map(|(i, s)| s.as_ref().map_or(0, |s| (value(i, s).clamp(0.0, 1.0) * 255.0).round() as u8)).collect()
        })
        .collect();
    let mut covered: Vec<bool> = samples.iter().map(Option::is_some).collect();
    dilate(&mut out, &mut covered, size);
    out.push(covered.iter().map(|&c| if c { 255 } else { 0 }).collect());
    out
}

/// The share of `dirs` (turned onto the normal) that hit the model within `reach`.
fn blocked(bvh: &Bvh, o: Vec3, n: Vec3, dirs: &[Vec3], turn: f32, reach: f32) -> f32 {
    dirs.iter().filter(|&&d| bvh.occluded(o, frame(n, d, turn), reach)).count() as f32 / dirs.len() as f32
}

/// The model spot under the centre of each texel (none where no UV island covers it).
fn rasterize(mesh: &Mesh, size: usize) -> Vec<Option<Sample>> {
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
                out[y * size + x] = Some(Sample { tri: t as u32, pos, normal, curve });
            }
        }
    }
    out
}

/// Per vertex: how much the surface bends away (positive, an edge) or in (negative, a crease),
/// from the smoothed normals of its welded neighbours, squashed into -1..1.
fn vertex_curvature(mesh: &Mesh) -> Vec<f32> {
    let weld = crate::weld_positions(&mesh.positions);
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
