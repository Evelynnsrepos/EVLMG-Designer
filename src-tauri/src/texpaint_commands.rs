//! Texture Paint's Rust core (the `texpaint` crate) for the web side: the screen sends the model it
//! shows once, then asks which triangles "Fill a part" takes and for baked helper maps.
//! The mobile app builds this file too (see its src-tauri/src/lib.rs).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use texpaint::bake::{self, Map};
use texpaint::topology::{FillMode, SelectOpts, Topology};
use texpaint::{Mesh, bvh::Bvh};

struct Loaded {
  mesh: Mesh,
  topo: Topology,
  bvh: Bvh,
}

/// The models the open Texture Paint documents sent, by document id.
#[derive(Default)]
pub struct TexpaintState(Mutex<HashMap<String, Arc<Loaded>>>);

impl TexpaintState {
  fn get(&self, doc: &str) -> Result<Arc<Loaded>, String> {
    self.0.lock().map_err(|e| e.to_string())?.get(doc).cloned().ok_or_else(|| "The model isn't ready yet.".into())
  }
}

/// Takes a model: the body is `Mesh::from_bytes`'s packed format, the `x-doc` header the document id.
#[tauri::command]
pub async fn texpaint_load(request: tauri::ipc::Request<'_>, state: tauri::State<'_, TexpaintState>) -> Result<u32, String> {
  let doc = request.headers().get("x-doc").and_then(|v| v.to_str().ok()).ok_or("no document id")?.to_string();
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("the model must be sent as bytes".into()) };
  let bytes = bytes.clone();
  let loaded = tauri::async_runtime::spawn_blocking(move || -> Result<Loaded, String> {
    let mesh = Mesh::from_bytes(&bytes)?;
    Ok(Loaded { topo: Topology::build(&mesh), bvh: Bvh::from_mesh(&mesh), mesh })
  })
  .await
  .map_err(|e| e.to_string())??;
  let count = loaded.mesh.triangle_count() as u32;
  state.0.lock().map_err(|e| e.to_string())?.insert(doc, Arc::new(loaded));
  Ok(count)
}

#[tauri::command]
pub fn texpaint_unload(doc: String, state: tauri::State<'_, TexpaintState>) {
  if let Ok(mut m) = state.0.lock() {
    m.remove(&doc);
  }
}

/// The triangles "Fill a part" takes around triangle `tri` (hit at `at`).
#[tauri::command]
pub fn texpaint_fill(doc: String, mode: String, tri: u32, at: [f32; 3], angle: f32, state: tauri::State<'_, TexpaintState>) -> Result<Vec<u32>, String> {
  let l = state.get(&doc)?;
  let mode = FillMode::from_key(&mode).ok_or("unknown fill mode")?;
  Ok(l.topo.select_with(mode, tri, &SelectOpts { at: Some(glam_vec(at)), angle }))
}

/// The triangle under a ray from the camera, so picking matches the triangles the core knows.
#[tauri::command]
pub fn texpaint_pick(doc: String, origin: [f32; 3], dir: [f32; 3], state: tauri::State<'_, TexpaintState>) -> Result<Option<(u32, [f32; 3])>, String> {
  let l = state.get(&doc)?;
  Ok(l.bvh.raycast(glam_vec(origin), glam_vec(dir).normalize_or_zero()).map(|h| (h.tri, h.pos.to_array())))
}

/// Bakes `maps` (keys of `bake::Map`) at `size`²: one grey byte per texel per map, then the coverage.
#[tauri::command]
pub async fn texpaint_bake(doc: String, size: u32, maps: Vec<String>, state: tauri::State<'_, TexpaintState>) -> Result<tauri::ipc::Response, String> {
  let l = state.get(&doc)?;
  let maps: Vec<Map> = maps.iter().map(|k| Map::from_key(k).ok_or_else(|| format!("unknown map {k}"))).collect::<Result<_, _>>()?;
  let out = tauri::async_runtime::spawn_blocking(move || bake::bake(&l.mesh, size, &maps).concat()).await.map_err(|e| e.to_string())?;
  Ok(tauri::ipc::Response::new(out))
}

fn glam_vec(v: [f32; 3]) -> texpaint::Vec3 {
  texpaint::Vec3::from_array(v)
}
