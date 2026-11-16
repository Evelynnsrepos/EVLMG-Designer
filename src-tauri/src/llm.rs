//! Optional AI helper for spelling and grammar suggestions (v0.4). Nothing ships with the
//! app: the user downloads llama.cpp's `llama-server` and a small model from
//! Settings into `<app data>/llm/`; "better" is a bigger optional model. The server runs on 127.0.0.1 only while
//! the app is open and is started on the first request.

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

/// Pinned so the archive layout and server flags stay known.
const LLAMA_TAG: &str = "b11347";
/// The models Settings offers: id, download URL, file name in `<app data>/llm/`.
/// "small" keeps the v0.4 file name so existing downloads still count.
const MODELS: [(&str, &str, &str); 3] = [
  ("small", "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf", "model.gguf"),
  ("better", "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "model-better.gguf"),
  ("best", "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf", "model-best.gguf"),
];

fn model_entry(model: &str) -> Result<(&'static str, &'static str), String> {
  MODELS.iter().find(|m| m.0 == model).map(|m| (m.1, m.2)).ok_or_else(|| format!("Unknown AI model: {model}"))
}

#[derive(Default)]
pub struct LlmState {
  /// The running server, its port and which model it loaded.
  server: Mutex<Option<(Child, u16, String)>>,
  installing: Mutex<bool>,
}

#[derive(Clone, Serialize)]
pub struct Progress {
  stage: &'static str,
  done: u64,
  total: u64,
}

fn llama_archive() -> Result<&'static str, String> {
  Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
    ("windows", "x86_64") => "bin-win-cpu-x64.zip",
    ("windows", "aarch64") => "bin-win-cpu-arm64.zip",
    ("macos", "aarch64") => "bin-macos-arm64.tar.gz",
    ("macos", "x86_64") => "bin-macos-x64.tar.gz",
    ("linux", "x86_64") => "bin-ubuntu-x64.tar.gz",
    (os, arch) => return Err(format!("The AI helper is not available for {os} {arch}.")),
  })
}

fn llm_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("llm"))
}

fn server_exe() -> &'static str {
  if cfg!(windows) { "llama-server.exe" } else { "llama-server" }
}

/// Windows' own bsdtar (System32) also reads zip; a GNU tar earlier on PATH (Git Bash) would not.
fn tar_exe() -> PathBuf {
  if cfg!(windows) {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    Path::new(&root).join("System32").join("tar.exe")
  } else {
    PathBuf::from("tar")
  }
}

fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
  for entry in fs::read_dir(dir).ok()?.flatten() {
    let path = entry.path();
    if path.is_dir() {
      if let Some(found) = find_file(&path, name) {
        return Some(found);
      }
    } else if path.file_name().is_some_and(|n| n == name) {
      return Some(path);
    }
  }
  None
}

fn installed(dir: &Path, model: &str) -> Option<(PathBuf, PathBuf)> {
  let model = dir.join(model_entry(model).ok()?.1);
  let server = find_file(&dir.join("bin"), server_exe())?;
  model.is_file().then_some((server, model))
}

/// Stream a URL to `dest`, reporting progress; written to `.part` first so a cancelled download never looks finished.
fn download(url: &str, dest: &Path, stage: &'static str, progress: &Channel<Progress>) -> Result<(), String> {
  let resp = ureq::get(url).call().map_err(|e| format!("Download failed: {e}"))?;
  let total = resp.headers().get("content-length").and_then(|v| v.to_str().ok()?.parse().ok()).unwrap_or(0);
  let mut reader = resp.into_body().into_reader();
  let part = dest.with_extension("part");
  let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
  let mut buf = vec![0u8; 1 << 20];
  let (mut done, mut last) = (0u64, Instant::now());
  loop {
    let n = reader.read(&mut buf).map_err(|e| format!("Download failed: {e}"))?;
    if n == 0 {
      break;
    }
    file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    done += n as u64;
    if last.elapsed() > Duration::from_millis(250) {
      let _ = progress.send(Progress { stage, done, total });
      last = Instant::now();
    }
  }
  drop(file);
  fs::rename(&part, dest).map_err(|e| e.to_string())
}

fn install(dir: &Path, model: &str, progress: &Channel<Progress>) -> Result<(), String> {
  let (model_url, model_file) = model_entry(model)?;
  fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  let bin = dir.join("bin");
  if find_file(&bin, server_exe()).is_none() {
    let name = format!("llama-{LLAMA_TAG}-{}", llama_archive()?);
    let url = format!("https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}/{name}");
    let archive = dir.join(&name);
    download(&url, &archive, "program", progress)?;
    let _ = fs::remove_dir_all(&bin);
    fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    // `tar` ships with Windows 10+, macOS and Linux and unpacks both .zip and .tar.gz.
    let status = Command::new(tar_exe()).arg("-xf").arg(&archive).arg("-C").arg(&bin).status().map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&archive);
    if !status.success() || find_file(&bin, server_exe()).is_none() {
      return Err("Could not unpack the AI helper program.".into());
    }
  }
  if !dir.join(model_file).is_file() {
    download(model_url, &dir.join(model_file), "model", progress)?;
  }
  Ok(())
}

#[tauri::command]
pub async fn llm_status(app: AppHandle, model: String) -> Result<bool, String> {
  Ok(installed(&llm_dir(&app)?, &model).is_some())
}

#[tauri::command]
pub async fn llm_install(app: AppHandle, model: String, progress: Channel<Progress>) -> Result<(), String> {
  let state = app.state::<LlmState>();
  {
    let mut busy = state.installing.lock().unwrap();
    if *busy {
      return Err("The AI helper is already downloading.".into());
    }
    *busy = true;
  }
  let dir = llm_dir(&app)?;
  let result = tauri::async_runtime::spawn_blocking(move || install(&dir, &model, &progress)).await.map_err(|e| e.to_string())?;
  *state.installing.lock().unwrap() = false;
  result
}

#[tauri::command]
pub async fn llm_remove(app: AppHandle) -> Result<(), String> {
  stop(&app);
  let dir = llm_dir(&app)?;
  if dir.exists() {
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Stop the server; called on remove and when the app exits.
pub fn stop(app: &AppHandle) {
  if let Some((mut child, _, _)) = app.state::<LlmState>().server.lock().unwrap().take() {
    let _ = child.kill();
    let _ = child.wait();
  }
}

/// The port of a server running `model`; starts it, or restarts it when the user picked another model.
fn ensure_server(app: &AppHandle, model: &str) -> Result<u16, String> {
  let state = app.state::<LlmState>();
  let mut server = state.server.lock().unwrap();
  if let Some((child, port, loaded)) = server.as_mut() {
    if loaded == model && child.try_wait().map_err(|e| e.to_string())?.is_none() {
      return Ok(*port);
    }
  }
  if let Some((mut child, _, _)) = server.take() {
    let _ = child.kill();
    let _ = child.wait();
  }
  let model_name = model;
  let (exe, model) = installed(&llm_dir(app)?, model).ok_or("This AI model is not downloaded.")?;
  let port = TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map_err(|e| e.to_string())?.port();
  let mut cmd = Command::new(&exe);
  cmd
    .arg("-m").arg(&model)
    .args(["--host", "127.0.0.1", "--port", &port.to_string(), "-c", "4096"])
    .current_dir(exe.parent().unwrap())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  let child = cmd.spawn().map_err(|e| format!("Could not start the AI helper: {e}"))?;
  *server = Some((child, port, model_name.to_string()));
  drop(server);

  let started = Instant::now();
  while started.elapsed() < Duration::from_secs(90) {
    if ureq::get(&format!("http://127.0.0.1:{port}/health")).call().is_ok() {
      return Ok(port);
    }
    std::thread::sleep(Duration::from_millis(300));
  }
  stop(app);
  Err("The AI helper did not start.".into())
}

/// The paragraph with its spelling, grammar and punctuation fixed, for underlining what changed
/// in the suggestion card. A small model is far better at rewriting text than at listing mistakes, so the
/// app diffs the answer itself. `lang` is "en" or "de"; asking in the text's language stops the
/// model from translating German into English.
#[tauri::command]
pub async fn llm_check(app: AppHandle, text: String, lang: String, model: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let port = ensure_server(&app, &model)?;
    let (system, example, fixed) = if lang == "de" {
      (
        "Du korrigierst deutschen Text. Gib den Text mit korrigierter Rechtschreibung, Grammatik und Zeichensetzung zurück. Behalte Bedeutung, Wortwahl, Namen und erfundene Wörter. Formuliere korrekten Text nicht um. Englische Wörter und Satzteile im Text sind Absicht: lass sie englisch und übersetze nichts. Antworte nur mit dem korrigierten Text.",
        "Die Wache sagen, das der König krank ist.",
        "Die Wache sagt, dass der König krank ist.",
      )
    } else {
      (
        "You proofread English text. Return the text with spelling, grammar and punctuation mistakes fixed. Keep the meaning, wording, names and made-up words. Do not rephrase correct text. German words and phrases in the text are on purpose: keep them German and never translate. Return only the corrected text.",
        "Their is to many goblin in the castel.",
        "There are too many goblins in the castle.",
      )
    };
    let body = serde_json::json!({
      "messages": [
        { "role": "system", "content": system },
        { "role": "user", "content": example },
        { "role": "assistant", "content": fixed },
        { "role": "user", "content": text }
      ],
      "temperature": 0,
      "max_tokens": text.len() / 2 + 64
    });
    let mut resp = ureq::post(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
      .send_json(&body)
      .map_err(|e| format!("The AI helper failed: {e}"))?;
    let json: serde_json::Value = resp.body_mut().read_json().map_err(|e| e.to_string())?;
    Ok(json["choices"][0]["message"]["content"].as_str().unwrap_or_default().trim().to_string())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Up to 3 ways to write the spot marked with `[[ ]]` in `sentence`, best first, one per line as the
/// model wrote them (the app cleans them up). Asked when the suggestion card opens.
#[tauri::command]
pub async fn llm_options(app: AppHandle, sentence: String, lang: String, model: String) -> Result<Vec<String>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let port = ensure_server(&app, &model)?;
    let (system, example, options) = if lang == "de" {
      (
        "Du hilfst beim Korrigieren einer Stelle im Satz. Die Stelle ist mit [[ ]] markiert. Gib 3 verschiedene korrekte Schreibweisen für die markierten Wörter, sodass der ganze Satz stimmt, eine pro Zeile, nur die Ersatzwörter, sonst nichts. Die beste zuerst. Behalte die Bedeutung. Niemals Englisch.",
        "Die Goblins [[rennt]] weg.",
        "rennen
rannten
sind gerannt",
      )
    } else {
      (
        "You help a writer fix one spot in a sentence. The spot is marked with [[ ]]. Give 3 different ways to write the marked words correctly so the whole sentence is right, one per line, only the replacement words, nothing else. Put the best one first. Keep the meaning.",
        "The goblins [[runned]] away.",
        "ran
had run
were running",
      )
    };
    let body = serde_json::json!({
      "messages": [
        { "role": "system", "content": system },
        { "role": "user", "content": example },
        { "role": "assistant", "content": options },
        { "role": "user", "content": sentence }
      ],
      "temperature": 0.3,
      "max_tokens": 60
    });
    let mut resp = ureq::post(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
      .send_json(&body)
      .map_err(|e| format!("The AI helper failed: {e}"))?;
    let json: serde_json::Value = resp.body_mut().read_json().map_err(|e| e.to_string())?;
    let text = json["choices"][0]["message"]["content"].as_str().unwrap_or_default();
    Ok(text.lines().map(str::to_string).collect())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Answer a question about the project from the notes the app picked for it ("Ask your project", v0.10).
/// Runs on the local AI helper only. It must answer from the notes alone and never write new content
/// (stories, scenes, dialogue, names, ideas): the user's ideas stay theirs.
#[tauri::command]
pub async fn llm_ask(app: AppHandle, question: String, notes: String, model: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let port = ensure_server(&app, &model)?;
    let system = "You look things up in a game designer's own notes. Answer only with facts that are written in the project notes below, \
      and name the entries you used. If the notes do not contain the answer, say that the project does not say yet. \
      Never write, invent or suggest anything new: no stories, scenes, dialogue, names, plots, ideas or continuations. \
      If you are asked to, say that this tool only answers about what is already written. \
      When asked to check for contradictions, list each one with the two conflicting statements, or say you found none. \
      Answer briefly, in the language of the question.";
    let body = serde_json::json!({
      "messages": [
        { "role": "system", "content": format!("{system}\n\nProject notes:\n{notes}") },
        { "role": "user", "content": question }
      ],
      "temperature": 0,
      "max_tokens": 350
    });
    let mut resp = ureq::post(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
      .send_json(&body)
      .map_err(|e| format!("The AI helper failed: {e}"))?;
    let json: serde_json::Value = resp.body_mut().read_json().map_err(|e| e.to_string())?;
    Ok(json["choices"][0]["message"]["content"].as_str().unwrap_or_default().trim().to_string())
  })
  .await
  .map_err(|e| e.to_string())?
}
