//! "Fill a part": picks whole triangles, quads, face loops, flat areas, loose parts, objects, UV
//! islands or texture sets around a clicked triangle.
//! Ported from Material Painter (https://github.com/alla2001/material-painter, src/polyfill.rs,
//! GPL-3.0-or-later, Copyright alla2001), used here under GPL-3.0.

use crate::{Mesh, weld_positions};
use glam::{Vec2, Vec3};
use std::collections::HashMap;

const NONE: u32 = u32::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FillMode {
    Triangle,
    /// A quad (two coplanar triangles sharing their long edge) or a triangle.
    Polygon,
    /// A loose part: a connected piece of one object.
    Part,
    /// A whole imported object (FBX/OBJ node), however many pieces it has.
    Object,
    /// A connected region of the UV layout.
    UvIsland,
    /// A strip of quads running through the edge nearest the cursor, as far
    /// as the quads go (around a cylinder, a whole ring).
    Loop,
    /// The faces reached without crossing an edge sharper than the flat-area
    /// angle: a panel, a bevel, a side of a box.
    Flat,
    /// Every face of the texture set (material) under the cursor.
    Set,
}

impl FillMode {
    pub const ALL: [FillMode; 8] =
        [FillMode::Triangle, FillMode::Polygon, FillMode::Loop, FillMode::Flat, FillMode::Part, FillMode::Object, FillMode::UvIsland, FillMode::Set];

    /// The mode for its key, as the Texture Paint screen sends it.
    pub fn from_key(key: &str) -> Option<FillMode> {
        FillMode::ALL.into_iter().find(|m| m.key() == key)
    }

    pub fn key(self) -> &'static str {
        match self {
            FillMode::Triangle => "triangle",
            FillMode::Polygon => "polygon",
            FillMode::Part => "part",
            FillMode::Object => "object",
            FillMode::UvIsland => "uv_island",
            FillMode::Loop => "loop",
            FillMode::Flat => "flat",
            FillMode::Set => "texture_set",
        }
    }
}

/// What a selection mode needs besides the triangle.
#[derive(Clone, Copy, Debug)]
pub struct SelectOpts {
    /// Where the pick landed on the triangle: the face loop runs through the edge nearest it.
    pub at: Option<Vec3>,
    /// Flat area: the sharpest edge (degrees between the faces) it spreads across.
    pub angle: f32,
}

impl Default for SelectOpts {
    fn default() -> Self {
        Self { at: None, angle: 30.0 }
    }
}

/// A quad (two triangles) or lone triangle's outline: its edges in order
/// around it, each as (triangle, edge k → k+1). A quad's edge i is opposite
/// edge i + 2.
struct Face {
    tris: Vec<u32>,
    edges: Vec<(u32, u8)>,
}

/// Mesh connectivity for the fill modes, built once per mesh.
pub struct Topology {
    positions: Vec<[Vec3; 3]>,
    /// Neighbor across each edge (k → k+1) on the 3D surface, or NONE.
    adj: Vec<[u32; 3]>,
    part: Vec<u32>,
    island: Vec<u32>,
    part_tris: Vec<Vec<u32>>,
    island_tris: Vec<Vec<u32>>,
    object: Vec<u32>,
    object_tris: Vec<Vec<u32>>,
    /// Texture sets, as triangle ranges.
    sets: Vec<std::ops::Range<u32>>,
}

fn union_find(n: usize, pairs: impl Iterator<Item = (u32, u32)>) -> (Vec<u32>, Vec<Vec<u32>>) {
    let mut parent: Vec<u32> = (0..n as u32).collect();
    fn find(p: &mut [u32], mut x: u32) -> u32 {
        while p[x as usize] != x {
            p[x as usize] = p[p[x as usize] as usize];
            x = p[x as usize];
        }
        x
    }
    for (a, b) in pairs {
        let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
        if ra != rb {
            parent[rb as usize] = ra;
        }
    }
    let mut remap = HashMap::new();
    let mut groups: Vec<Vec<u32>> = Vec::new();
    let id: Vec<u32> = (0..n as u32)
        .map(|t| {
            let root = find(&mut parent, t);
            let g = *remap.entry(root).or_insert_with(|| {
                groups.push(Vec::new());
                groups.len() as u32 - 1
            });
            groups[g as usize].push(t);
            g
        })
        .collect();
    (id, groups)
}

impl Topology {
    pub fn build(mesh: &Mesh) -> Topology {
        let tris = mesh.triangle_count();
        let weld = weld_positions(&mesh.positions);
        let corner = |t: usize, k: usize| mesh.indices[t * 3 + k] as usize;
        let positions: Vec<[Vec3; 3]> = (0..tris).map(|t| mesh.corners(t)).collect();
        let uvs: Vec<[Vec2; 3]> = (0..tris).map(|t| [0, 1, 2].map(|k| mesh.uvs[corner(t, k)])).collect();

        // Surface edges by welded position, UV edges by quantized UV.
        let mut surface: HashMap<(usize, usize), Vec<(u32, u8)>> = HashMap::with_capacity(tris * 3);
        let mut uv_edges: HashMap<([i32; 2], [i32; 2]), Vec<u32>> = HashMap::with_capacity(tris * 3);
        let q = |v: Vec2| [(v.x * 1.0e5).round() as i32, (v.y * 1.0e5).round() as i32];
        for t in 0..tris {
            for k in 0..3 {
                let (a, b) = (weld[corner(t, k)], weld[corner(t, (k + 1) % 3)]);
                surface.entry((a.min(b), a.max(b))).or_default().push((t as u32, k as u8));
                let (ua, ub) = (q(uvs[t][k]), q(uvs[t][(k + 1) % 3]));
                uv_edges.entry(if ua <= ub { (ua, ub) } else { (ub, ua) }).or_default().push(t as u32);
            }
        }
        let object_of = |t: u32| mesh.tri_object.get(t as usize).copied().unwrap_or(0);
        let mut adj = vec![[NONE; 3]; tris];
        let mut part_pairs = Vec::new();
        for sides in surface.values() {
            if let [(t0, k0), (t1, k1)] = sides[..] {
                adj[t0 as usize][k0 as usize] = t1;
                adj[t1 as usize][k1 as usize] = t0;
            }
            // Objects that touch (welded at the same positions) stay apart.
            for w in sides.windows(2) {
                if object_of(w[0].0) == object_of(w[1].0) {
                    part_pairs.push((w[0].0, w[1].0));
                }
            }
        }
        let mut island_pairs = Vec::new();
        for t in 0..tris {
            for k in 0..3 {
                let (ua, ub) = (q(uvs[t][k]), q(uvs[t][(k + 1) % 3]));
                let users = &uv_edges[&if ua <= ub { (ua, ub) } else { (ub, ua) }];
                for &o in users {
                    if o != t as u32 {
                        island_pairs.push((t as u32, o));
                    }
                }
            }
        }
        let (part, part_tris) = union_find(tris, part_pairs.into_iter());
        let (island, island_tris) = union_find(tris, island_pairs.into_iter());
        let object: Vec<u32> = (0..tris as u32).map(object_of).collect();
        let mut object_tris = vec![Vec::new(); object.iter().max().map_or(0, |m| *m as usize + 1)];
        for (t, &o) in object.iter().enumerate() {
            object_tris[o as usize].push(t as u32);
        }
        let sets = mesh.sets.clone();
        Topology { positions, adj, part, island, part_tris, island_tris, object, object_tris, sets }
    }

    /// The loose part triangle `t` belongs to, and how many parts there are.
    pub fn part_of(&self, t: usize) -> (u32, usize) {
        (self.part[t], self.part_tris.len())
    }

    pub fn triangle_count(&self) -> usize {
        self.positions.len()
    }

    pub fn centroid(&self, t: u32) -> Vec3 {
        let p = &self.positions[t as usize];
        (p[0] + p[1] + p[2]) / 3.0
    }

    /// The triangles `mode` selects around triangle `t`.
    pub fn select(&self, mode: FillMode, t: u32) -> Vec<u32> {
        self.select_with(mode, t, &SelectOpts::default())
    }

    fn normal(&self, t: usize) -> Vec3 {
        let p = &self.positions[t];
        (p[1] - p[0]).cross(p[2] - p[0]).normalize_or_zero()
    }

    fn longest_edge(&self, t: usize) -> usize {
        let p = &self.positions[t];
        (0..3).max_by(|&a, &b| p[a].distance_squared(p[(a + 1) % 3]).total_cmp(&p[b].distance_squared(p[(b + 1) % 3]))).unwrap()
    }

    /// The other half of a triangulated quad: the neighbor across the
    /// triangle's longest edge (the diagonal), if that is its longest edge
    /// too and the two bend by less than `min_dot`.
    fn quad_partner(&self, t: usize, min_dot: f32) -> Option<(usize, usize)> {
        let k = self.longest_edge(t);
        let n = self.adj[t][k];
        (n != NONE && self.normal(t).dot(self.normal(n as usize)) > min_dot && self.adj[n as usize][self.longest_edge(n as usize)] == t as u32)
            .then_some((n as usize, k))
    }

    /// The quad (or lone triangle) triangle `t` belongs to, with its outline in order.
    fn face(&self, t: usize) -> Face {
        let Some((n, k)) = self.quad_partner(t, 0.5) else {
            return Face { tris: vec![t as u32], edges: (0..3).map(|e| (t as u32, e as u8)).collect() };
        };
        let m = (0..3).find(|&e| self.adj[n][e] == t as u32).unwrap_or(0);
        // t's diagonal runs c_k → c_k+1; with matching winding, n's runs back c_k+1 → c_k.
        let same_winding = self.positions[n][m] == self.positions[t][(k + 1) % 3];
        let (t32, n32) = (t as u32, n as u32);
        let (k1, k2, m1, m2) = (((k + 1) % 3) as u8, ((k + 2) % 3) as u8, ((m + 1) % 3) as u8, ((m + 2) % 3) as u8);
        let edges = if same_winding { vec![(t32, k1), (t32, k2), (n32, m1), (n32, m2)] } else { vec![(t32, k1), (t32, k2), (n32, m2), (n32, m1)] };
        Face { tris: vec![t32, n32], edges }
    }

    fn edge_points(&self, (t, k): (u32, u8)) -> (Vec3, Vec3) {
        let p = &self.positions[t as usize];
        (p[k as usize], p[(k as usize + 1) % 3])
    }

    /// A strip of quads through `face`'s edge `exit` and onward through
    /// each next quad's opposite edge, until the quads stop or it closes.
    fn walk_loop(&self, face: &Face, exit: usize, seen: &mut std::collections::HashSet<u32>, out: &mut Vec<u32>) {
        let mut edge = face.edges[exit];
        loop {
            let next = self.adj[edge.0 as usize][edge.1 as usize];
            if next == NONE || seen.contains(&next) {
                return;
            }
            let f = self.face(next as usize);
            // Only quads carry a loop on.
            if f.tris.len() != 2 {
                return;
            }
            let Some(entry) = f.edges.iter().position(|&(t, k)| self.adj[t as usize][k as usize] == edge.0) else { return };
            for &t in &f.tris {
                seen.insert(t);
                out.push(t);
            }
            edge = f.edges[(entry + 2) % 4];
        }
    }

    /// The triangles `mode` selects around triangle `t`.
    pub fn select_with(&self, mode: FillMode, t: u32, opts: &SelectOpts) -> Vec<u32> {
        let ti = t as usize;
        if ti >= self.positions.len() {
            return Vec::new();
        }
        match mode {
            FillMode::Triangle => vec![t],
            // A flat (planar) quad only.
            FillMode::Polygon => match self.quad_partner(ti, 0.999) {
                Some((n, _)) => vec![t, n as u32],
                None => vec![t],
            },
            FillMode::Part => self.part_tris[self.part[ti] as usize].clone(),
            FillMode::Object => self.object_tris[self.object[ti] as usize].clone(),
            FillMode::UvIsland => self.island_tris[self.island[ti] as usize].clone(),
            FillMode::Set => match self.sets.iter().find(|r| r.contains(&t)) {
                Some(r) => r.clone().collect(),
                None => (0..self.positions.len() as u32).collect(),
            },
            FillMode::Flat => {
                let min_dot = opts.angle.clamp(0.0, 180.0).to_radians().cos();
                let mut seen = std::collections::HashSet::from([t]);
                let mut out = vec![t];
                let mut stack = vec![ti];
                while let Some(a) = stack.pop() {
                    let na = self.normal(a);
                    for &b in &self.adj[a] {
                        if b != NONE && na.dot(self.normal(b as usize)) >= min_dot - 1e-6 && seen.insert(b) {
                            out.push(b);
                            stack.push(b as usize);
                        }
                    }
                }
                out
            }
            FillMode::Loop => {
                let face = self.face(ti);
                if face.tris.len() != 2 {
                    return face.tris;
                }
                // Through the edge nearest the pick (or the first one), both ways.
                let at = opts.at.unwrap_or_else(|| self.centroid(t));
                let dist = |e: (u32, u8)| {
                    let (a, b) = self.edge_points(e);
                    let ab = b - a;
                    let s = ((at - a).dot(ab) / ab.length_squared().max(1e-12)).clamp(0.0, 1.0);
                    at.distance(a + ab * s)
                };
                let exit = (0..4).min_by(|&a, &b| dist(face.edges[a]).total_cmp(&dist(face.edges[b]))).unwrap_or(0);
                let mut seen: std::collections::HashSet<u32> = face.tris.iter().copied().collect();
                let mut out = face.tris.clone();
                self.walk_loop(&face, exit, &mut seen, &mut out);
                self.walk_loop(&face, (exit + 2) % 4, &mut seen, &mut out);
                out
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shapes;

    #[test]
    fn keys_round_trip() {
        for m in FillMode::ALL {
            assert_eq!(FillMode::from_key(m.key()), Some(m));
        }
        assert_eq!(FillMode::from_key("nope"), None);
    }

    #[test]
    fn modes_grow_as_expected() {
        let topo = Topology::build(&shapes::cylinder(16, 4));
        let side = 0;
        assert_eq!(topo.select(FillMode::Triangle, side), vec![0]);
        let quad = topo.select(FillMode::Polygon, side);
        assert!(quad.len() <= 2 && quad.contains(&0));
        // The side is its own UV island; the caps are others, but the whole cylinder is one part.
        let island = topo.select(FillMode::UvIsland, side);
        assert_eq!(island.len(), 16 * 4 * 2);
        let part = topo.select(FillMode::Part, side);
        assert_eq!(part.len(), topo.triangle_count());
        let total: usize = topo.part_tris.iter().map(Vec::len).sum();
        assert_eq!(total, topo.triangle_count());
        assert!(topo.select(FillMode::Triangle, 99_999).is_empty(), "out of range is empty, not a crash");
    }

    #[test]
    fn loops_flat_areas_and_sets() {
        let topo = Topology::build(&shapes::cylinder(16, 4));
        let n = topo.triangle_count() as u32;
        let side = (0..n).find(|&t| topo.normal(t as usize).y.abs() < 0.1 && topo.face(t as usize).tris.len() == 2).expect("a side quad");
        let face = topo.face(side as usize);
        let edge_dir = |e: (u32, u8)| {
            let (a, b) = topo.edge_points(e);
            (b - a).normalize()
        };
        let vertical = face.edges.iter().position(|&e| edge_dir(e).y.abs() > 0.9).expect("a vertical edge");
        let horizontal = face.edges.iter().position(|&e| edge_dir(e).y.abs() < 0.1).expect("a horizontal edge");
        let mid = |e: (u32, u8)| {
            let (a, b) = topo.edge_points(e);
            (a + b) * 0.5
        };
        let ring = topo.select_with(FillMode::Loop, side, &SelectOpts { at: Some(mid(face.edges[vertical])), ..Default::default() });
        let column = topo.select_with(FillMode::Loop, side, &SelectOpts { at: Some(mid(face.edges[horizontal])), ..Default::default() });
        let y = topo.centroid(side).y;
        assert_eq!(ring.len(), 32, "a ring of 16 quads around the cylinder");
        assert!(ring.iter().all(|&t| (topo.centroid(t).y - y).abs() < 0.3), "the ring stays at one height");
        // Up the side: 4 quads, then the loop may carry on one fan pair into each cap (as in Material Painter).
        let column_side: Vec<u32> = column.iter().copied().filter(|&t| topo.normal(t as usize).y.abs() < 0.1).collect();
        assert_eq!(column_side.len(), 8, "a column of 4 quads up the side");
        assert!(column_side.iter().all(|&t| topo.normal(t as usize).dot(topo.normal(side as usize)) > 0.9), "the column stays on one side");
        // Flat area: the side bends 22.5 degrees between quads, so a wide angle takes it all and a
        // tight one only the column; the caps (90 degrees off) stay out either way.
        let wide = topo.select_with(FillMode::Flat, side, &SelectOpts { angle: 45.0, ..Default::default() });
        let tight = topo.select_with(FillMode::Flat, side, &SelectOpts { angle: 1.0, ..Default::default() });
        assert_eq!(wide.len(), 16 * 4 * 2);
        assert!(tight.len() < wide.len());
        assert!(wide.iter().all(|&t| topo.normal(t as usize).y.abs() < 0.5), "flat area stops at the caps");
        assert_eq!(topo.select(FillMode::Set, side).len(), n as usize);
        assert_eq!(topo.select(FillMode::Object, side).len(), n as usize);
    }

    #[test]
    fn objects_that_touch_stay_apart() {
        // Two planes on top of each other, from two different meshes of the file.
        let a = shapes::plane(2);
        let mut m = shapes::plane(2);
        let off = m.positions.len() as u32;
        m.positions.extend(a.positions.iter().copied());
        m.normals.extend(a.normals.iter().copied());
        m.uvs.extend(a.uvs.iter().copied());
        m.indices.extend(a.indices.iter().map(|i| i + off));
        m.tri_object.extend(std::iter::repeat_n(1, a.triangle_count()));
        let topo = Topology::build(&m);
        assert_eq!(topo.select(FillMode::Part, 0).len(), 8);
        assert_eq!(topo.select(FillMode::Object, 9).len(), 8);
        assert!(topo.select(FillMode::Object, 9).iter().all(|&t| t >= 8));
    }
}
