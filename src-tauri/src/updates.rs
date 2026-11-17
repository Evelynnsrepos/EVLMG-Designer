//! Updates (desktop only): check GitHub's latest.json, and install signed updates where the app can replace itself.
//! Phones update through their app stores, so the mobile app never registers these commands.
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const LATEST: &str = "https://github.com/Evelynnsrepos/EVLMG-Designer/releases/latest/download/latest.json";

/// The update file to read: `EGD_UPDATE_URL` points the app at a test latest.json before a real release.
fn endpoint() -> String {
  std::env::var("EGD_UPDATE_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| LATEST.into())
}

/// How this install gets updates: "self" (Windows installer, macOS app, AppImage), "flatpak" (Flatpak replaces it),
/// "system" (.deb or a source build: the system or the person updates it).
fn kind() -> &'static str {
  if std::env::var_os("FLATPAK_ID").is_some() {
    "flatpak"
  } else if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
    // shortcut: .deb installs only get told about new versions; the updater can install .deb too, try it after a real Debian test.
    "system"
  } else {
    "self"
  }
}

/// "0.34.0" < "0.34.1" < "0.40.0". Pre-release suffixes are ignored (we never release them).
fn newer(remote: &str, current: &str) -> bool {
  let parts = |v: &str| -> Vec<u64> {
    v.trim_start_matches('v').split(['.', '-', '+']).take(3).map(|p| p.parse().unwrap_or(0)).collect()
  };
  parts(remote) > parts(current)
}

#[derive(Serialize)]
pub struct UpdateInfo {
  kind: &'static str,
  current: String,
  /// None = this is the newest version.
  version: Option<String>,
  notes: String,
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateInfo, String> {
  let current = app.package_info().version.to_string();
  let url = endpoint();
  let json: serde_json::Value = tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
    let mut res = ureq::get(&url).call().map_err(|e| format!("Couldn't check: {e}"))?;
    res.body_mut().read_json().map_err(|e| format!("The update file couldn't be read: {e}"))
  })
  .await
  .map_err(|e| e.to_string())??;
  let remote = json["version"].as_str().unwrap_or("").to_string();
  Ok(UpdateInfo {
    kind: kind(),
    version: newer(&remote, &current).then(|| remote.trim_start_matches('v').to_string()),
    notes: json["notes"].as_str().unwrap_or("").to_string(),
    current,
  })
}

#[derive(Clone, Serialize)]
struct Progress {
  done: usize,
  total: Option<u64>,
}

/// Download, check the signature, install. Emits "update-progress". The app restarts only when update_restart is called.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
  if kind() != "self" {
    return Err("This install is updated by the system, not by the app.".into());
  }
  let url = endpoint().parse().map_err(|e| format!("{e}"))?;
  let updater = app.updater_builder().endpoints(vec![url]).and_then(|b| b.build()).map_err(|e| e.to_string())?;
  let update = updater.check().await.map_err(|e| format!("Couldn't check: {e}"))?.ok_or("This is already the newest version.")?;
  let mut done = 0;
  update
    .download_and_install(
      |chunk, total| {
        done += chunk;
        let _ = app.emit("update-progress", Progress { done, total });
      },
      || {},
    )
    .await
    // A bad signature lands here too: nothing was installed then.
    .map_err(|e| format!("The update didn't install, nothing was changed: {e}"))
}

#[tauri::command]
pub fn update_restart(app: AppHandle) {
  app.restart();
}

#[cfg(test)]
mod tests {
  use super::newer;

  #[test]
  fn compares_versions_by_number() {
    assert!(newer("0.34.1", "0.34.0"));
    assert!(newer("v0.40.0", "0.34.9"));
    assert!(newer("1.0.0", "0.99.99"));
    assert!(!newer("0.34.0", "0.34.0"));
    assert!(!newer("0.33.9", "0.34.0"));
    assert!(!newer("", "0.34.0"));
  }
}
