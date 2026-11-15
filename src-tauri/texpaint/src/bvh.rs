//! Binned-SAH bounding volume hierarchy over triangles, for picking and baking on the CPU.
//! Ported from Material Painter (https://github.com/alla2001/material-painter, src/bvh.rs,
//! GPL-3.0-or-later, Copyright alla2001), used here under GPL-3.0.

use crate::Mesh;
use glam::Vec3;

#[derive(Clone, Copy)]
pub struct Node {
    pub min: Vec3,
    pub max: Vec3,
    /// Leaf: first index into `order`. Interior: index of the left child (right = left + 1).
    pub first: u32,
    /// Triangle count; zero for interior nodes.
    pub count: u32,
}

pub struct Bvh {
    pub nodes: Vec<Node>,
    /// Original triangle index for each leaf slot.
    pub order: Vec<u32>,
    /// Triangles in leaf order.
    tris: Vec<[Vec3; 3]>,
}

pub struct Hit {
    pub pos: Vec3,
    /// Index of the hit triangle in the source mesh.
    pub tri: u32,
    /// Barycentric weights of the triangle's three vertices at the hit.
    pub bary: Vec3,
}

const BINS: usize = 12;
const MAX_LEAF: u32 = 4;

fn area(min: Vec3, max: Vec3) -> f32 {
    let e = (max - min).max(Vec3::ZERO);
    2.0 * (e.x * e.y + e.y * e.z + e.z * e.x)
}

impl Bvh {
    pub fn from_mesh(mesh: &Mesh) -> Bvh {
        Bvh::build((0..mesh.triangle_count()).map(|t| mesh.corners(t)).collect())
    }

    pub fn build(tris: Vec<[Vec3; 3]>) -> Bvh {
        let n = tris.len();
        let bmin: Vec<Vec3> = tris.iter().map(|t| t[0].min(t[1]).min(t[2])).collect();
        let bmax: Vec<Vec3> = tris.iter().map(|t| t[0].max(t[1]).max(t[2])).collect();
        let cent: Vec<Vec3> = (0..n).map(|i| (bmin[i] + bmax[i]) * 0.5).collect();
        let mut order: Vec<u32> = (0..n as u32).collect();
        let mut nodes = Vec::with_capacity(2 * n / MAX_LEAF as usize + 1);
        nodes.push(Node { min: Vec3::ZERO, max: Vec3::ZERO, first: 0, count: n as u32 });
        let mut stack = vec![0usize];

        while let Some(ni) = stack.pop() {
            let (first, count) = (nodes[ni].first as usize, nodes[ni].count as usize);
            let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
            let (mut clo, mut chi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
            for &p in &order[first..first + count] {
                let p = p as usize;
                lo = lo.min(bmin[p]);
                hi = hi.max(bmax[p]);
                clo = clo.min(cent[p]);
                chi = chi.max(cent[p]);
            }
            nodes[ni].min = lo;
            nodes[ni].max = hi;
            if count as u32 <= MAX_LEAF {
                continue;
            }

            // Binned SAH over all three axes.
            let ext = chi - clo;
            let mut best: Option<(f32, usize, usize)> = None;
            for axis in 0..3 {
                if ext[axis] <= 1e-12 {
                    continue;
                }
                let scale = BINS as f32 / ext[axis];
                let mut bcount = [0u32; BINS];
                let mut bb = [(Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)); BINS];
                for &p in &order[first..first + count] {
                    let p = p as usize;
                    let b = (((cent[p][axis] - clo[axis]) * scale) as usize).min(BINS - 1);
                    bcount[b] += 1;
                    bb[b].0 = bb[b].0.min(bmin[p]);
                    bb[b].1 = bb[b].1.max(bmax[p]);
                }
                let mut left_area = [0.0f32; BINS];
                let mut left_count = [0u32; BINS];
                let (mut l, mut h, mut c) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN), 0);
                for i in 0..BINS - 1 {
                    c += bcount[i];
                    l = l.min(bb[i].0);
                    h = h.max(bb[i].1);
                    left_count[i] = c;
                    left_area[i] = if c > 0 { area(l, h) } else { 0.0 };
                }
                let (mut l, mut h, mut c) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN), 0);
                for i in (1..BINS).rev() {
                    c += bcount[i];
                    l = l.min(bb[i].0);
                    h = h.max(bb[i].1);
                    if left_count[i - 1] == 0 || c == 0 {
                        continue;
                    }
                    let cost = left_count[i - 1] as f32 * left_area[i - 1] + c as f32 * area(l, h);
                    if best.is_none_or(|b| cost < b.0) {
                        best = Some((cost, axis, i));
                    }
                }
            }

            let leaf_cost = count as f32 * area(lo, hi);
            let mid = match best {
                Some((cost, axis, split_bin)) if cost < leaf_cost || count > 16 => {
                    let scale = BINS as f32 / ext[axis];
                    let (mut i, mut j) = (first, first + count);
                    while i < j {
                        let p = order[i] as usize;
                        let b = (((cent[p][axis] - clo[axis]) * scale) as usize).min(BINS - 1);
                        if b < split_bin {
                            i += 1;
                        } else {
                            j -= 1;
                            order.swap(i, j);
                        }
                    }
                    i
                }
                // All centroids coincide; split the list so leaves stay small.
                None if count > 16 => first + count / 2,
                _ => continue,
            };

            let left = nodes.len();
            nodes.push(Node { min: lo, max: hi, first: first as u32, count: (mid - first) as u32 });
            nodes.push(Node { min: lo, max: hi, first: mid as u32, count: (first + count - mid) as u32 });
            nodes[ni].first = left as u32;
            nodes[ni].count = 0;
            stack.push(left);
            stack.push(left + 1);
        }

        let tris = order.iter().map(|&i| tris[i as usize]).collect();
        Bvh { nodes, order, tris }
    }

    fn slab(min: Vec3, max: Vec3, o: Vec3, inv: Vec3, tmax: f32) -> bool {
        let t0 = (min - o) * inv;
        let t1 = (max - o) * inv;
        let tn = t0.min(t1).max_element().max(0.0);
        let tf = t0.max(t1).min_element().min(tmax);
        tn <= tf
    }

    /// Ray distance and the (u, v) barycentrics of vertices 1 and 2.
    fn tri_hit(tri: &[Vec3; 3], o: Vec3, d: Vec3, tmax: f32) -> Option<(f32, f32, f32)> {
        let e1 = tri[1] - tri[0];
        let e2 = tri[2] - tri[0];
        let p = d.cross(e2);
        let det = e1.dot(p);
        if det.abs() < 1e-12 {
            return None;
        }
        let inv = 1.0 / det;
        let s = o - tri[0];
        // A hair of tolerance, so rays through shared edges and vertices
        // can't slip between neighboring triangles.
        const EPS: f32 = 1e-5;
        let u = s.dot(p) * inv;
        if !(-EPS..=1.0 + EPS).contains(&u) {
            return None;
        }
        let q = s.cross(e1);
        let v = d.dot(q) * inv;
        if v < -EPS || u + v > 1.0 + EPS {
            return None;
        }
        let t = e2.dot(q) * inv;
        (t > 0.0 && t < tmax).then_some((t, u, v))
    }

    pub fn raycast(&self, o: Vec3, d: Vec3) -> Option<Hit> {
        let inv = d.recip();
        let mut tmax = f32::MAX;
        let mut best = None;
        // On the stack, not the heap: rays are cast millions of times per bake.
        let mut stack = [0u32; 64];
        let mut top = 1;
        while top > 0 {
            top -= 1;
            let ni = stack[top];
            let node = &self.nodes[ni as usize];
            if !Self::slab(node.min, node.max, o, inv, tmax) {
                continue;
            }
            if node.count > 0 {
                let first = node.first as usize;
                for (k, tri) in self.tris[first..first + node.count as usize].iter().enumerate() {
                    if let Some((t, u, v)) = Self::tri_hit(tri, o, d, tmax) {
                        tmax = t;
                        best = Some((t, first + k, u, v));
                    }
                }
            } else {
                // A SAH tree is far shallower than 64 levels; past that, the far child is skipped.
                if top + 2 <= stack.len() {
                    stack[top] = node.first;
                    stack[top + 1] = node.first + 1;
                    top += 2;
                }
            }
        }
        best.map(|(t, slot, u, v)| Hit { pos: o + d * t, tri: self.order[slot], bary: Vec3::new(1.0 - u - v, u, v) })
    }

    /// Whether anything lies along the segment `o + d·t` (0 < t < `tmax`); stops at the first hit.
    pub fn occluded(&self, o: Vec3, d: Vec3, tmax: f32) -> bool {
        let inv = d.recip();
        // On the stack, not the heap: rays are cast millions of times per bake.
        let mut stack = [0u32; 64];
        let mut top = 1;
        while top > 0 {
            top -= 1;
            let ni = stack[top];
            let node = &self.nodes[ni as usize];
            if !Self::slab(node.min, node.max, o, inv, tmax) {
                continue;
            }
            if node.count > 0 {
                let first = node.first as usize;
                if self.tris[first..first + node.count as usize].iter().any(|tri| Self::tri_hit(tri, o, d, tmax).is_some()) {
                    return true;
                }
            } else {
                // A SAH tree is far shallower than 64 levels; past that, the far child is skipped.
                if top + 2 <= stack.len() {
                    stack[top] = node.first;
                    stack[top + 1] = node.first + 1;
                    top += 2;
                }
            }
        }
        false
    }
}
