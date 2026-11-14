//! Texture Paint's Rust core: the model's shape as triangles, "Fill a part" picking and
//! mesh-map baking on every CPU core. The live painting stays on the graphics card in the
//! web view (Draw's engine); this crate does the heavy geometry work the web side is slow at.
//!
//! Large parts are ported from Material Painter by alla2001
//! (https://github.com/alla2001/material-painter, GPL-3.0-or-later), used here under GPL-3.0.

pub mod bake;
pub mod bvh;
pub mod topology;

pub use glam::{Vec2, Vec3};
use std::collections::HashMap;

/// A triangle model as the 3D view has it (every mesh of the file merged, in world space).
pub struct Mesh {
    pub positions: Vec<Vec3>,
    pub normals: Vec<Vec3>,
    /// Texture coordinates in picture space: (0, 0) is the texture's top left corner.
    pub uvs: Vec<Vec2>,
    pub indices: Vec<u32>,
    /// Which mesh of the file each triangle came from.
    pub tri_object: Vec<u32>,
    /// Texture sets (materials), as triangle ranges.
    pub sets: Vec<std::ops::Range<u32>>,
}

impl Mesh {
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    pub fn corners(&self, t: usize) -> [Vec3; 3] {
        [0, 1, 2].map(|k| self.positions[self.indices[t * 3 + k] as usize])
    }

    /// Reads the packed model the Texture Paint screen sends (all little endian): vertex count,
    /// triangle count and set count as u32; then positions (3 × f32), normals (3 × f32) and UVs
    /// (2 × f32) per vertex; 3 indices and an object id per triangle (u32); start and end per set (u32).
    pub fn from_bytes(b: &[u8]) -> Result<Mesh, String> {
        let mut at = 0usize;
        let mut u32s = |n: usize| -> Result<Vec<u32>, String> {
            let end = at.checked_add(n.checked_mul(4).ok_or("model too big")?).ok_or("model too big")?;
            let s = b.get(at..end).ok_or("the model data is cut short")?;
            at = end;
            Ok(s.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
        };
        let head = u32s(3)?;
        let (nv, nt, ns) = (head[0] as usize, head[1] as usize, head[2] as usize);
        let f = |v: Vec<u32>| v.into_iter().map(f32::from_bits).collect::<Vec<f32>>();
        let positions: Vec<Vec3> = f(u32s(nv * 3)?).chunks_exact(3).map(Vec3::from_slice).collect();
        let normals: Vec<Vec3> = f(u32s(nv * 3)?).chunks_exact(3).map(|n| Vec3::from_slice(n).normalize_or_zero()).collect();
        let uvs: Vec<Vec2> = f(u32s(nv * 2)?).chunks_exact(2).map(Vec2::from_slice).collect();
        let indices = u32s(nt * 3)?;
        let tri_object = u32s(nt)?;
        let sets: Vec<std::ops::Range<u32>> = u32s(ns * 2)?.chunks_exact(2).map(|r| r[0]..r[1]).collect();
        if at != b.len() {
            return Err("the model data has extra bytes".into());
        }
        if indices.iter().any(|&i| i as usize >= nv) {
            return Err("a triangle points past the last vertex".into());
        }
        if sets.iter().any(|r| r.start > r.end || r.end as usize > nt) {
            return Err("a texture set points past the last triangle".into());
        }
        if positions.iter().chain(&normals).any(|v| !v.is_finite()) || uvs.iter().any(|v| !v.is_finite()) {
            return Err("the model has broken numbers".into());
        }
        Ok(Mesh { positions, normals, uvs, indices, tri_object, sets })
    }
}

/// The first vertex at the same position (within 0.1 mm at 1 unit = 1 m) for each vertex, so split
/// UV seams and hard edges still count as connected.
pub fn weld_positions(positions: &[Vec3]) -> Vec<usize> {
    let mut map: HashMap<[i32; 3], usize> = HashMap::with_capacity(positions.len());
    positions
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let key = (*p * 1.0e4).round().as_ivec3().to_array();
            *map.entry(key).or_insert(i)
        })
        .collect()
}

/// Small test models.
#[cfg(test)]
pub(crate) mod shapes {
    use super::*;
    use std::f32::consts::TAU;

    /// A capped cylinder of `seg` quads around and `rows` quads up, side and caps as separate UV islands.
    pub fn cylinder(seg: u32, rows: u32) -> Mesh {
        let mut m = Mesh { positions: vec![], normals: vec![], uvs: vec![], indices: vec![], tri_object: vec![], sets: vec![] };
        for r in 0..=rows {
            for s in 0..=seg {
                let a = s as f32 / seg as f32 * TAU;
                let y = r as f32 / rows as f32 * 2.0 - 1.0;
                m.positions.push(Vec3::new(a.cos(), y, a.sin()));
                m.normals.push(Vec3::new(a.cos(), 0.0, a.sin()));
                m.uvs.push(Vec2::new(s as f32 / seg as f32, 0.5 + 0.5 * r as f32 / rows as f32));
            }
        }
        for r in 0..rows {
            for s in 0..seg {
                let i = r * (seg + 1) + s;
                let (a, b, c, d) = (i, i + 1, i + seg + 1, i + seg + 2);
                m.indices.extend([a, c, b, b, c, d]);
            }
        }
        for (y, flip) in [(-1.0f32, false), (1.0, true)] {
            let centre = m.positions.len() as u32;
            m.positions.push(Vec3::new(0.0, y, 0.0));
            m.normals.push(Vec3::new(0.0, y, 0.0));
            m.uvs.push(Vec2::new(if flip { 0.75 } else { 0.25 }, 0.25));
            for s in 0..=seg {
                let a = s as f32 / seg as f32 * TAU;
                m.positions.push(Vec3::new(a.cos(), y, a.sin()));
                m.normals.push(Vec3::new(0.0, y, 0.0));
                m.uvs.push(Vec2::new(if flip { 0.75 } else { 0.25 } + 0.2 * a.cos(), 0.25 + 0.2 * a.sin()));
            }
            for s in 0..seg {
                let (p, q) = (centre + 1 + s, centre + 2 + s);
                m.indices.extend(if flip { [centre, q, p] } else { [centre, p, q] });
            }
        }
        let n = m.triangle_count() as u32;
        m.tri_object = vec![0; n as usize];
        m.sets = vec![0..n];
        m
    }

    /// A flat grid on the floor (y = 0), `n` × `n` quads, one UV island.
    pub fn plane(n: u32) -> Mesh {
        let mut m = Mesh { positions: vec![], normals: vec![], uvs: vec![], indices: vec![], tri_object: vec![], sets: vec![] };
        for z in 0..=n {
            for x in 0..=n {
                let (u, v) = (x as f32 / n as f32, z as f32 / n as f32);
                m.positions.push(Vec3::new(u * 2.0 - 1.0, 0.0, v * 2.0 - 1.0));
                m.normals.push(Vec3::Y);
                m.uvs.push(Vec2::new(u, v));
            }
        }
        for z in 0..n {
            for x in 0..n {
                let i = z * (n + 1) + x;
                m.indices.extend([i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2]);
            }
        }
        let t = m.triangle_count() as u32;
        m.tri_object = vec![0; t as usize];
        m.sets = vec![0..t];
        m
    }

    /// Packs a mesh the way the Texture Paint screen does.
    pub fn pack(m: &Mesh) -> Vec<u8> {
        let mut out = Vec::new();
        let mut put = |v: u32| out.extend_from_slice(&v.to_le_bytes());
        put(m.positions.len() as u32);
        put(m.triangle_count() as u32);
        put(m.sets.len() as u32);
        m.positions.iter().flat_map(|p| p.to_array()).for_each(|f| put(f.to_bits()));
        m.normals.iter().flat_map(|p| p.to_array()).for_each(|f| put(f.to_bits()));
        m.uvs.iter().flat_map(|p| p.to_array()).for_each(|f| put(f.to_bits()));
        m.indices.iter().for_each(|&i| put(i));
        m.tri_object.iter().for_each(|&i| put(i));
        m.sets.iter().for_each(|r| {
            put(r.start);
            put(r.end)
        });
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packed_model_round_trips_and_bad_data_is_refused() {
        let m = shapes::cylinder(8, 2);
        let bytes = shapes::pack(&m);
        let back = Mesh::from_bytes(&bytes).expect("reads");
        assert_eq!(back.indices, m.indices);
        assert_eq!(back.positions.len(), m.positions.len());
        assert_eq!(back.sets, m.sets);
        assert!(Mesh::from_bytes(&bytes[..bytes.len() - 4]).is_err(), "cut short");
        let mut extra = bytes.clone();
        extra.extend([0, 0, 0, 0]);
        assert!(Mesh::from_bytes(&extra).is_err(), "extra bytes");
        let mut bad = bytes.clone();
        // The first index (right after the vertex data) points far past the vertices.
        let first_index = 12 + m.positions.len() * 32;
        bad[first_index..first_index + 4].copy_from_slice(&999_999u32.to_le_bytes());
        assert!(Mesh::from_bytes(&bad).is_err(), "index out of range");
        assert!(Mesh::from_bytes(&[]).is_err());
        // A huge count in the header must fail cleanly, not allocate or overflow.
        let mut huge = bytes.clone();
        huge[0..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(Mesh::from_bytes(&huge).is_err());
    }
}
