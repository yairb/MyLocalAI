use crate::models::{AppSettings, EngineStatusResponse};
use parking_lot::Mutex;
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct EngineState {
    pub status: String,
    pub message: String,
    pub progress: f64,
    pub model_loaded: Option<String>,
    pub error: Option<String>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            status: "idle".into(),
            message: "Idle".into(),
            progress: 0.0,
            model_loaded: None,
            error: None,
        }
    }
}

pub struct LlamaManager {
    child: Mutex<Option<Child>>,
    state: Mutex<EngineState>,
}

impl LlamaManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            child: Mutex::new(None),
            state: Mutex::new(EngineState::default()),
        })
    }

    pub fn status(&self) -> EngineStatusResponse {
        let s = self.state.lock();
        EngineStatusResponse {
            status: s.status.clone(),
            message: s.message.clone(),
            progress: s.progress,
            model_loaded: s.model_loaded.clone(),
            error: s.error.clone(),
        }
    }

    fn set_state(
        &self,
        status: &str,
        message: &str,
        progress: f64,
        model: Option<String>,
        error: Option<String>,
    ) {
        let mut s = self.state.lock();
        s.status = status.into();
        s.message = message.into();
        s.progress = progress;
        if model.is_some() {
            s.model_loaded = model;
        }
        s.error = error;
    }

    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.set_state("idle", "Engine stopped", 0.0, None, None);
    }

    pub fn start(self: &Arc<Self>, settings: &AppSettings) -> EngineStatusResponse {
        // Already healthy?
        if is_port_open(&settings.llama_host, settings.llama_port as u16) {
            let name = settings
                .model_name
                .clone()
                .or_else(|| settings.model_path.as_ref().map(|p| basename(p)));
            self.set_state(
                "ready",
                "Connected to running llama-server",
                100.0,
                name,
                None,
            );
            return self.status();
        }

        let model_path = match &settings.model_path {
            Some(p) if Path::new(p).exists() => p.clone(),
            Some(p) => {
                self.set_state(
                    "error",
                    "Model file not found",
                    0.0,
                    None,
                    Some(format!("Missing model at {p}")),
                );
                return self.status();
            }
            None => {
                // Try default models dir for a GGUF
                if let Some(found) = find_first_gguf(&models_dir()) {
                    found
                } else {
                    self.set_state(
                        "no_model",
                        "No GGUF model selected",
                        0.0,
                        None,
                        Some(format!(
                            "Place a .gguf file in {} or select one in Settings",
                            models_dir().display()
                        )),
                    );
                    return self.status();
                }
            }
        };

        let binary = resolve_llama_binary(settings.llama_binary_path.as_deref());
        let Some(binary) = binary else {
            self.set_state(
                "error",
                "llama-server binary not found",
                0.0,
                None,
                Some(
                    "Install llama.cpp (brew install llama.cpp) or set llama binary path in settings."
                        .into(),
                ),
            );
            return self.status();
        };

        // Kill previous child if any
        self.stop();
        self.set_state("starting", "Starting AI engine…", 10.0, None, None);

        let host = settings.llama_host.clone();
        let port = settings.llama_port as u16;
        let ctx = settings.context_size;
        let gpu = settings.gpu_layers;
        let model_name = basename(&model_path);

        let mut cmd = Command::new(&binary);
        cmd.arg("--model")
            .arg(&model_path)
            .arg("--ctx-size")
            .arg(ctx.to_string())
            .arg("--host")
            .arg(&host)
            .arg("--port")
            .arg(port.to_string())
            .arg("--n-gpu-layers")
            .arg(gpu.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        log::info!("Starting llama-server: {:?}", cmd);

        match cmd.spawn() {
            Ok(mut child) => {
                // Capture stderr for progress / errors
                if let Some(stderr) = child.stderr.take() {
                    let manager = Arc::clone(self);
                    let model_name_log = model_name.clone();
                    thread::spawn(move || {
                        let reader = BufReader::new(stderr);
                        for line in reader.lines().flatten() {
                            log::debug!("llama-server: {line}");
                            let lower = line.to_lowercase();
                            if lower.contains("loading") || lower.contains("load") {
                                manager.set_state(
                                    "loading",
                                    "Loading model…",
                                    40.0,
                                    Some(model_name_log.clone()),
                                    None,
                                );
                            }
                            if lower.contains("error") || lower.contains("failed") {
                                manager.set_state(
                                    "error",
                                    "Engine error",
                                    0.0,
                                    None,
                                    Some(line),
                                );
                            }
                        }
                    });
                }

                *self.child.lock() = Some(child);
                self.set_state(
                    "loading",
                    "Loading model…",
                    35.0,
                    Some(model_name.clone()),
                    None,
                );

                // Wait for health in background
                let manager = Arc::clone(self);
                let model_name_bg = model_name;
                thread::spawn(move || {
                    for i in 0..120 {
                        if is_port_open(&host, port) {
                            // Extra check via HTTP-ish TCP success is enough for readiness
                            manager.set_state(
                                "ready",
                                "Ready",
                                100.0,
                                Some(model_name_bg),
                                None,
                            );
                            return;
                        }
                        // progressive progress while waiting
                        let p = 35.0 + (i as f64 / 120.0) * 60.0;
                        manager.set_state(
                            "loading",
                            "Loading model into memory…",
                            p,
                            None,
                            None,
                        );
                        thread::sleep(Duration::from_millis(500));
                    }
                    manager.set_state(
                        "error",
                        "Timed out waiting for llama-server",
                        0.0,
                        None,
                        Some("Server did not become ready within 60s".into()),
                    );
                });
            }
            Err(e) => {
                self.set_state(
                    "error",
                    "Failed to start llama-server",
                    0.0,
                    None,
                    Some(e.to_string()),
                );
            }
        }

        self.status()
    }
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn is_port_open(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    TcpStream::connect_timeout(
        &addr.parse().unwrap_or_else(|_| {
            format!("127.0.0.1:{port}")
                .parse()
                .expect("valid addr")
        }),
        Duration::from_millis(400),
    )
    .is_ok()
}

pub fn app_support_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("MyLocalAI")
}

pub fn models_dir() -> PathBuf {
    let dir = app_support_dir().join("models");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn db_path() -> PathBuf {
    let dir = app_support_dir();
    let _ = std::fs::create_dir_all(&dir);
    dir.join("mylocalai.db")
}

fn find_first_gguf(dir: &Path) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

pub fn list_gguf_models() -> Vec<String> {
    let dir = models_dir();
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    names.push(name.to_string());
                }
            }
        }
    }
    names.sort();
    names
}

fn resolve_llama_binary(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = configured {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }

    // Bundled resource (optional)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = [
                dir.join("llama-server"),
                dir.join("../Resources/llama-server"),
                dir.join("resources/llama-server"),
            ];
            for c in candidates {
                if c.exists() {
                    return Some(c);
                }
            }
        }
    }

    // Common install locations (Homebrew / local builds)
    let candidates = [
        "/opt/homebrew/bin/llama-server",
        "/usr/local/bin/llama-server",
        "/opt/homebrew/bin/llama-cpp-server",
        &format!(
            "{}/.local/bin/llama-server",
            dirs::home_dir()
                .map(|h| h.display().to_string())
                .unwrap_or_default()
        ),
    ];

    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }

    // PATH lookup
    which("llama-server").or_else(|| which("llama-cpp-server"))
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
