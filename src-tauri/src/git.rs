//! Git sync (0.19): runs the user's own installed `git` in a project folder.
//! Only `git` can be started from here, never another program.

use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Serialize)]
pub struct GitOutput {
  /// Exit code; -1 when git was stopped because it took too long.
  code: i32,
  stdout: String,
  stderr: String,
}

fn git(cwd: &str, args: &[String]) -> Command {
  let mut cmd = Command::new("git");
  cmd.args(args).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
  // Never wait on a hidden password prompt: fail with a message instead.
  cmd.env("GIT_TERMINAL_PROMPT", "0");
  if std::env::var_os("GIT_SSH_COMMAND").is_none() {
    cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  cmd
}

fn run(cwd: String, args: Vec<String>, timeout_ms: u64) -> Result<GitOutput, String> {
  let mut child = git(&cwd, &args).spawn().map_err(|e| format!("Could not start Git: {e}"))?;
  // Read both pipes on their own threads so a chatty git never blocks on a full pipe.
  let mut out = child.stdout.take().unwrap();
  let mut err = child.stderr.take().unwrap();
  let out_t = std::thread::spawn(move || {
    let mut s = String::new();
    let _ = out.read_to_string(&mut s);
    s
  });
  let err_t = std::thread::spawn(move || {
    let mut s = String::new();
    let _ = err.read_to_string(&mut s);
    s
  });
  let deadline = Instant::now() + Duration::from_millis(timeout_ms);
  let code = loop {
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
      break status.code().unwrap_or(-1);
    }
    if Instant::now() > deadline {
      let _ = child.kill();
      let _ = child.wait();
      break -1;
    }
    std::thread::sleep(Duration::from_millis(30));
  };
  Ok(GitOutput { code, stdout: out_t.join().unwrap_or_default(), stderr: err_t.join().unwrap_or_default() })
}

/// Runs `git <args>` in `cwd` and returns its output, or stops it after `timeout_ms`.
#[tauri::command]
pub async fn git_run(cwd: String, args: Vec<String>, timeout_ms: u64) -> Result<GitOutput, String> {
  tauri::async_runtime::spawn_blocking(move || run(cwd, args, timeout_ms)).await.map_err(|e| e.to_string())?
}

/// The installed git's version text, or None when git is not installed.
#[tauri::command]
pub async fn git_version() -> Option<String> {
  let home = std::env::temp_dir().to_string_lossy().into_owned();
  let out = tauri::async_runtime::spawn_blocking(move || run(home, vec!["--version".into()], 10_000)).await.ok()?.ok()?;
  (out.code == 0).then(|| out.stdout.trim().to_string())
}
