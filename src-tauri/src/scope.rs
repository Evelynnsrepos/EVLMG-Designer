//! Which folders the app window may read and write. The capability allows the person's own folders (home, documents,
//! app data); project folders elsewhere (another drive, a USB stick) are added here when a project is opened or made.
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

/// Only a folder that holds a project (project.json) or doesn't exist yet / is empty (a new project) can be added,
/// so a web page or bad project content can't use this to reach system folders.
fn may_allow(dir: &Path) -> bool {
  dir.is_absolute()
    && (dir.join("project.json").is_file() || !dir.exists() || dir.read_dir().map(|mut d| d.next().is_none()).unwrap_or(false))
}

#[tauri::command]
pub fn fs_allow_project(app: AppHandle, path: String) -> Result<(), String> {
  let dir = Path::new(&path);
  if !may_allow(dir) {
    return Err(format!("{path} is not a project folder"));
  }
  app.fs_scope().allow_directory(dir, true).map_err(|e| e.to_string())?;
  app.asset_protocol_scope().allow_directory(dir, true).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::may_allow;

  #[test]
  fn only_project_or_new_folders() {
    let base = std::env::temp_dir().join(format!("egd-scope-{}", std::process::id()));
    let project = base.join("game");
    std::fs::create_dir_all(&project).unwrap();
    assert!(may_allow(&project), "empty folder: a new project");
    std::fs::write(project.join("notes.txt"), "x").unwrap();
    assert!(!may_allow(&project), "a folder with other files");
    std::fs::write(project.join("project.json"), "{}").unwrap();
    assert!(may_allow(&project));
    assert!(may_allow(&base.join("not-made-yet")));
    assert!(!may_allow(Path::new("relative")));
    assert!(!may_allow(Path::new("/etc")));
    std::fs::remove_dir_all(&base).unwrap();
  }
  use std::path::Path;
}
