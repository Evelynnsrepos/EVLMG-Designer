use tauri::Manager;

mod collab;
mod collab_commands;
mod git;
mod llm;
mod plugins;
mod server_link;
mod spell;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .manage(llm::LlmState::default())
    .manage(collab_commands::CollabState::default())
    .manage(server_link::ServerLinks::default())
    .invoke_handler(tauri::generate_handler![
      spell::spell_check,
      spell::spell_suggest,
      git::git_run,
      git::git_version,
      llm::llm_status,
      llm::llm_install,
      llm::llm_remove,
      llm::llm_check,
      llm::llm_options,
      llm::llm_ask,
      plugins::plugin_download,
      collab_commands::collab_start,
      collab_commands::collab_addr,
      collab_commands::collab_connect,
      collab_commands::collab_send,
      collab_commands::collab_disconnect,
      collab_commands::collab_stop,
      server_link::server_connect,
      server_link::server_send,
      server_link::server_send_text,
      server_link::server_close,
    ])
    .setup(|app| {
      if let Some(window) = app.get_webview_window("main") {
        // Display name, not productName: productName stays so installers upgrade in place.
        let title = format!("Eve.Lopment Games Designer {}", app.package_info().version);
        let _ = window.set_title(&title);
      }
      // btop/top show the process name (15 bytes at most): put the version there too.
      #[cfg(target_os = "linux")]
      let _ = std::fs::write("/proc/self/comm", format!("EVLMG {}", app.package_info().version));
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        llm::stop(app);
      }
    });
}
