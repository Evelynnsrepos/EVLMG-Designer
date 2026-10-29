//! How the Linux webview uses the graphics card (0.24). The choice lives in a small file in the app's
//! config folder, because WebKitGTK reads its settings from the environment before the window exists.
//! "auto": graphics card always on. "no-dmabuf": the older way to hand pictures to the screen, for
//! graphics drivers where the window stays blank or drawing is very slow. "software": no graphics card.

const MODES: [&str; 3] = ["auto", "no-dmabuf", "software"];

fn mode_file() -> Option<std::path::PathBuf> {
  // Same folder Tauri's app_config_dir uses on Linux (inside a Flatpak, XDG_CONFIG_HOME points into ~/.var/app).
  let base = std::env::var_os("XDG_CONFIG_HOME")
    .map(std::path::PathBuf::from)
    .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")))?;
  Some(base.join("io.github.evelynnsrepos.egd").join("graphics-mode"))
}

fn read_mode() -> String {
  let mode = mode_file().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
  let mode = mode.trim();
  if MODES.contains(&mode) { mode.to_string() } else { "auto".into() }
}

/// Call first thing in `run`, before any thread or window starts.
pub fn apply_env() {
  if !cfg!(target_os = "linux") {
    return;
  }
  let vars: &[&str] = match read_mode().as_str() {
    "no-dmabuf" => &["WEBKIT_DISABLE_DMABUF_RENDERER"],
    "software" => &["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE", "LIBGL_ALWAYS_SOFTWARE"],
    _ => &[],
  };
  for v in vars {
    // A value the user set themselves wins.
    if std::env::var_os(v).is_none() {
      // SAFETY: runs at the start of `run`, before any other thread exists.
      unsafe { std::env::set_var(v, "1") };
    }
  }
}

/// Graphics card always on in "auto" (WebKitGTK otherwise switches it on only for some pages), off in "software".
#[cfg(target_os = "linux")]
pub fn apply_webview(window: &tauri::WebviewWindow) {
  let software = read_mode() == "software";
  let _ = window.with_webview(move |w| {
    use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
    if let Some(settings) = w.inner().settings() {
      settings.set_hardware_acceleration_policy(if software { HardwareAccelerationPolicy::Never } else { HardwareAccelerationPolicy::Always });
    }
  });
}

/// WebKitGTK hands a pen to the page as a mouse (pressure 0 or 0.5, no tilt). Read pressure and tilt from GTK and
/// put them on `window.__nativePen`, where Draw picks them up for the pointer event that follows.
#[cfg(target_os = "linux")]
pub fn forward_pen(window: &tauri::WebviewWindow) {
  let _ = window.with_webview(|w| {
    use gtk::{gdk, glib, prelude::*};
    use webkit2gtk::WebViewExt;
    fn send(view: &webkit2gtk::WebView, e: &gdk::Event) {
      let pen = e.source_device().map(|d| matches!(d.source(), gdk::InputSource::Pen | gdk::InputSource::Eraser)).unwrap_or(false);
      let Some(pressure) = e.axis(gdk::AxisUse::Pressure).filter(|_| pen) else { return };
      // GTK gives tilt as -1..1 on some backends and in degrees on others.
      let deg = |t: f64| if t.abs() <= 1.0 { t * 90.0 } else { t };
      let tx = deg(e.axis(gdk::AxisUse::Xtilt).unwrap_or(0.0));
      let ty = deg(e.axis(gdk::AxisUse::Ytilt).unwrap_or(0.0));
      let js = format!("window.__nativePen={{pressure:{pressure},tiltX:{tx},tiltY:{ty},t:performance.now()}}");
      view.evaluate_javascript(&js, None, None, None::<&gtk::gio::Cancellable>, |_| {});
    }
    let view = w.inner();
    view.connect_motion_notify_event(|v, e| {
      send(v, e);
      glib::Propagation::Proceed
    });
    view.connect_button_press_event(|v, e| {
      send(v, e);
      glib::Propagation::Proceed
    });
  });
}

#[tauri::command]
pub fn graphics_mode_get() -> String {
  read_mode()
}

/// Takes effect the next time the app starts.
#[tauri::command]
pub fn graphics_mode_set(mode: String) -> Result<(), String> {
  if !MODES.contains(&mode.as_str()) {
    return Err(format!("unknown graphics mode {mode}"));
  }
  let file = mode_file().ok_or("no config folder")?;
  if let Some(dir) = file.parent() {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  std::fs::write(file, mode).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  #[test]
  fn refuses_unknown_modes() {
    assert!(super::graphics_mode_set("fast-please".into()).is_err());
  }
}
