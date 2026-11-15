//! Shape maths for the Vector tool. JS writes a JSON request into WASM memory and calls `run`;
//! the answer is JSON too. Paths travel as SVG path data plus a 2D matrix (shape → drawing).

use kurbo::{Affine, BezPath, Point, Vec2};
use serde::{Deserialize, Serialize};
use vectorcraft_geom::{FillRule, PathData};
use vectorcraft_pathops as ops;

#[derive(Deserialize)]
struct In {
    d: String,
    /// [a, b, c, d, e, f] like SVG/Canvas; identity when missing.
    #[serde(default)]
    m: Option<[f64; 6]>,
    #[serde(default)]
    evenodd: bool,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Req {
    /// unite | minus_front | intersect | exclude | divide over a stack (back to front).
    Combine { mode: String, shapes: Vec<In> },
    /// Every separate area of overlapping shapes (shape builder).
    Regions { shapes: Vec<In> },
    /// Grow (+) or shrink (−) a filled shape.
    Offset { shape: In, delta: f64, round: bool },
    /// The area an outline covers, as a fillable shape.
    Outline { shape: In, width: f64, round: bool },
    /// Anchors of a shape (Edit points on a live shape, SVG import).
    Anchors { shape: In },
    /// Smooth curves through freehand points (pencil).
    Fit { points: Vec<[f64; 2]>, closed: bool, tolerance: f64 },
}

#[derive(Serialize)]
struct Piece {
    /// Anchor list per sub-path, VectorCraft's wire form ({p, in?, out?, kind?}).
    paths: Vec<vectorcraft_geom::SubPath>,
    /// Which input shapes this piece came from (front-most last).
    sources: Vec<usize>,
}

fn path_of(s: &In) -> Result<(PathData, FillRule), String> {
    let mut bp = BezPath::from_svg(&s.d).map_err(|e| format!("bad path: {e}"))?;
    if let Some([a, b, c, d, e, f]) = s.m {
        bp.apply_affine(Affine::new([a, b, c, d, e, f]));
    }
    Ok((PathData::from_bezpath(&bp), if s.evenodd { FillRule::EvenOdd } else { FillRule::NonZero }))
}

fn piece(p: PathData, sources: Vec<usize>) -> Piece {
    Piece { paths: p.subpaths, sources }
}

fn handle(req: Req) -> Result<Vec<Piece>, String> {
    Ok(match req {
        Req::Combine { mode, shapes } => {
            let op = match mode.as_str() {
                "unite" => ops::PathfinderOp::Unite,
                "minus_front" => ops::PathfinderOp::MinusFront,
                "intersect" => ops::PathfinderOp::Intersect,
                "exclude" => ops::PathfinderOp::Exclude,
                "divide" => ops::PathfinderOp::Divide,
                other => return Err(format!("unknown mode {other}")),
            };
            let stack = shapes
                .iter()
                .enumerate()
                .map(|(i, s)| path_of(s).map(|(p, r)| ops::Shape::new(p, r, i as u64)))
                .collect::<Result<Vec<_>, _>>()?;
            ops::pathfinder(op, &stack).into_iter().map(|s| piece(s.path, vec![s.key as usize])).collect()
        }
        Req::Regions { shapes } => {
            let stack = shapes
                .iter()
                .enumerate()
                .map(|(i, s)| path_of(s).map(|(p, r)| ops::Shape::new(p, r, i as u64)))
                .collect::<Result<Vec<_>, _>>()?;
            ops::regions_within(&stack, 2000).ok_or("too many pieces")?.into_iter().map(|r| piece(r.path, r.sources)).collect()
        }
        Req::Offset { shape, delta, round } => {
            let (p, _) = path_of(&shape)?;
            let join = if round { ops::Join::Round } else { ops::Join::Miter };
            vec![piece(ops::try_offset_path(&p, delta, join, 4.0).map_err(|e| e.to_string())?, vec![0])]
        }
        Req::Outline { shape, width, round } => {
            let (p, _) = path_of(&shape)?;
            let (cap, join) = if round { (ops::Cap::Round, ops::Join::Round) } else { (ops::Cap::Butt, ops::Join::Miter) };
            vec![piece(ops::outline_stroke(&p, width, cap, join, 4.0), vec![0])]
        }
        Req::Anchors { shape } => vec![piece(path_of(&shape)?.0, vec![0])],
        Req::Fit { points, closed, tolerance } => {
            let pts: Vec<Point> = points.iter().map(|[x, y]| Point::new(*x, *y)).collect();
            if pts.len() < 2 {
                return Ok(vec![]);
            }
            let mut bp = BezPath::new();
            bp.move_to(pts[0]);
            for c in ops::fit_cubics(&pts, Vec2::ZERO, Vec2::ZERO, tolerance) {
                bp.curve_to(c.p1, c.p2, c.p3);
            }
            if closed {
                bp.close_path();
            }
            vec![piece(PathData::from_bezpath(&bp), vec![0])]
        }
    })
}

/// JSON request → JSON answer: `{"ok": [...pieces]}` or `{"err": "..."}`.
pub fn run_json(req: &str) -> String {
    let out = serde_json::from_str::<Req>(req).map_err(|e| e.to_string()).and_then(handle);
    match out {
        Ok(p) => serde_json::json!({ "ok": p }).to_string(),
        Err(e) => serde_json::json!({ "err": e }).to_string(),
    }
}

// ---------- WASM boundary ----------

static mut OUT: Vec<u8> = Vec::new();

/// Room for a request of `len` bytes; JS writes it there and passes it to `run`.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Runs a request (freeing it) and returns where the answer is; its length comes from `out_len`.
///
/// # Safety
/// `ptr` must come from `alloc(len)` and hold `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn run(ptr: *mut u8, len: usize) -> *const u8 {
    let bytes = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let answer = run_json(&String::from_utf8_lossy(&bytes)).into_bytes();
    // Single-threaded WASM: one answer at a time, read by JS before the next call.
    #[allow(static_mut_refs)]
    unsafe {
        OUT = answer;
        OUT.as_ptr()
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn out_len() -> usize {
    #[allow(static_mut_refs)]
    unsafe {
        OUT.len()
    }
}

#[cfg(test)]
mod tests {
    use super::run_json;

    #[test]
    fn cut_a_hole() {
        let r = run_json(r#"{"op":"combine","mode":"minus_front","shapes":[{"d":"M0 0H10V10H0Z"},{"d":"M3 3H7V7H3Z"}]}"#);
        assert!(r.starts_with(r#"{"ok":[{"paths":[{"#), "{r}");
        assert_eq!(r.matches("\"closed\":true").count(), 2, "outer + hole: {r}");
    }

    #[test]
    fn bad_input_is_an_error() {
        assert!(run_json(r#"{"op":"anchors","shape":{"d":"Q"}}"#).starts_with(r#"{"err""#));
    }
}
