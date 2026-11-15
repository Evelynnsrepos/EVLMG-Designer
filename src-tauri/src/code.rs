//! Code Studio: starts the game engine the user picked (Godot), streams what it prints, and carries
//! language server messages over a local TCP connection.
//! Only a program whose file name contains "godot" can be started from here, never another one,
//! and the language server connection only goes to this computer (127.0.0.1).

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State};

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CodeEvent {
  /// A line the program printed.
  Out { text: String },
  /// A line the program printed as an error.
  Err { text: String },
  /// The program ended.
  Exit { code: i32 },
  /// One language server message (JSON).
  Msg { text: String },
  /// The language server connection ended.
  Closed,
}

#[derive(Default)]
pub struct CodeState {
  procs: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
  lsp: Mutex<Option<TcpStream>>,
}

fn is_godot(program: &str) -> bool {
  Path::new(program).file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.to_lowercase().contains("godot"))
}

fn command(program: &str, args: &[String]) -> Result<Command, String> {
  if !is_godot(program) {
    return Err("Only Godot can be started from Code Studio.".into());
  }
  let mut cmd = Command::new(program);
  cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW (the console window, not the game's)
  }
  Ok(cmd)
}

fn kill(child: &Arc<Mutex<Child>>) {
  if let Ok(mut c) = child.lock() {
    let _ = c.kill();
    let _ = c.wait();
  }
}

/// The program's version text (`godot --version`), or None when it can't be started.
#[tauri::command]
pub async fn code_engine_version(program: String) -> Option<String> {
  tauri::async_runtime::spawn_blocking(move || {
    let out = command(&program, &["--version".into()]).ok()?.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
  })
  .await
  .ok()?
}

/// Starts the engine as process `id` ("run" for the game, "lsp" for the hidden editor) and streams its output.
/// A process already running under that id is stopped first.
#[tauri::command]
pub async fn code_start(state: State<'_, CodeState>, id: String, program: String, args: Vec<String>, cwd: String, on_event: Channel<CodeEvent>) -> Result<(), String> {
  let mut child = command(&program, &args)?.current_dir(&cwd).spawn().map_err(|e| format!("Could not start {program}: {e}"))?;
  let out = child.stdout.take().unwrap();
  let err = child.stderr.take().unwrap();
  let child = Arc::new(Mutex::new(child));
  if let Some(old) = state.procs.lock().unwrap().insert(id, child.clone()) {
    kill(&old);
  }
  let ch = on_event.clone();
  std::thread::spawn(move || {
    for line in BufReader::new(err).lines().map_while(Result::ok) {
      let _ = ch.send(CodeEvent::Err { text: line });
    }
  });
  std::thread::spawn(move || {
    for line in BufReader::new(out).lines().map_while(Result::ok) {
      let _ = on_event.send(CodeEvent::Out { text: line });
    }
    // Output closed: wait for the end without holding the lock, so Stop still works.
    let code = loop {
      match child.lock().unwrap().try_wait() {
        Ok(Some(status)) => break status.code().unwrap_or(-1),
        Ok(None) => {}
        Err(_) => break -1,
      }
      std::thread::sleep(Duration::from_millis(100));
    };
    let _ = on_event.send(CodeEvent::Exit { code });
  });
  Ok(())
}

#[tauri::command]
pub fn code_stop(state: State<'_, CodeState>, id: String) {
  let child = state.procs.lock().unwrap().remove(&id);
  if let Some(child) = child {
    kill(&child);
  }
}

/// Takes one complete `Content-Length` framed message off the front of `buf`, if there is one.
fn take_message(buf: &mut Vec<u8>) -> Option<String> {
  let head_end = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
  let head = String::from_utf8_lossy(&buf[..head_end]).to_lowercase();
  let len: usize = head.lines().find_map(|l| l.strip_prefix("content-length:"))?.trim().parse().ok()?;
  let start = head_end + 4;
  if buf.len() < start + len {
    return None;
  }
  let text = String::from_utf8_lossy(&buf[start..start + len]).into_owned();
  buf.drain(..start + len);
  Some(text)
}

/// Connects to a language server on this computer (Godot: port 6005) and streams its messages.
#[tauri::command]
pub async fn code_lsp_connect(state: State<'_, CodeState>, port: u16, on_event: Channel<CodeEvent>) -> Result<(), String> {
  let addr = SocketAddr::from(([127, 0, 0, 1], port));
  let stream = tauri::async_runtime::spawn_blocking(move || TcpStream::connect_timeout(&addr, Duration::from_millis(800)))
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
  let mut reader = stream.try_clone().map_err(|e| e.to_string())?;
  if let Some(old) = state.lsp.lock().unwrap().replace(stream) {
    let _ = old.shutdown(Shutdown::Both);
  }
  std::thread::spawn(move || {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    while let Ok(n) = reader.read(&mut chunk) {
      if n == 0 {
        break;
      }
      buf.extend_from_slice(&chunk[..n]);
      while let Some(text) = take_message(&mut buf) {
        let _ = on_event.send(CodeEvent::Msg { text });
      }
    }
    let _ = on_event.send(CodeEvent::Closed);
  });
  Ok(())
}

#[tauri::command]
pub fn code_lsp_send(state: State<'_, CodeState>, text: String) -> Result<(), String> {
  let mut guard = state.lsp.lock().unwrap();
  let stream = guard.as_mut().ok_or("Not connected")?;
  write!(stream, "Content-Length: {}\r\n\r\n{}", text.len(), text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn code_lsp_close(state: State<'_, CodeState>) {
  if let Some(stream) = state.lsp.lock().unwrap().take() {
    let _ = stream.shutdown(Shutdown::Both);
  }
}

/// Stops everything Code Studio started; called when the app closes.
pub fn stop(app: &tauri::AppHandle) {
  let state = app.state::<CodeState>();
  for (_, child) in state.procs.lock().unwrap().drain() {
    kill(&child);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_godot_starts() {
    assert!(is_godot("godot"));
    assert!(is_godot("/opt/Godot_v4.5-stable_linux.x86_64"));
    assert!(is_godot("C:\\Tools\\Godot_v4.5-stable_win64.exe") || cfg!(not(windows)));
    assert!(!is_godot("/bin/sh"));
    assert!(!is_godot("/tmp/godot/rm"));
  }

  #[test]
  fn splits_framed_messages() {
    let mut buf = b"Content-Length: 2\r\n\r\n{}Content-Length: 7\r\nContent-Type: x\r\n\r\n{\"a\":".to_vec();
    assert_eq!(take_message(&mut buf).as_deref(), Some("{}"));
    assert_eq!(take_message(&mut buf), None); // second one is not complete yet
    buf.extend_from_slice(b"1}");
    assert_eq!(take_message(&mut buf).as_deref(), Some("{\"a\":1}"));
    assert!(buf.is_empty());
  }
}
