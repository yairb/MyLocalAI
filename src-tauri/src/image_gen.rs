//! Local image generation backend (Stable Diffusion via stable-diffusion.cpp).
//!
//! Architecture: the UI talks to an abstract provider; this module is the
//! Stable Diffusion implementation. It shells out to the `sd` binary
//! (stable-diffusion.cpp), matching how llama.cpp is managed for chat.
//!
//! Progress is emitted as Tauri events so the UI stays responsive.

use crate::llama::app_support_dir;
use crate::models::{ImageGenProgressEvent, ImageGenerateParams, ImageGenerateResult};
use parking_lot::Mutex;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Provider-agnostic image generation manager (Stable Diffusion today).
pub struct ImageGenManager {
    child: Mutex<Option<Child>>,
    cancel_flag: AtomicBool,
    busy: AtomicBool,
}

impl ImageGenManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            child: Mutex::new(None),
            cancel_flag: AtomicBool::new(false),
            busy: AtomicBool::new(false),
        })
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    pub fn cancel(&self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Generate an image asynchronously-friendly: runs on a blocking thread
    /// and emits progress events on `image-gen-progress`.
    pub fn generate(
        self: &Arc<Self>,
        app: AppHandle,
        params: ImageGenerateParams,
        binary_path: Option<String>,
        backend: Option<String>,
    ) -> Result<ImageGenerateResult, String> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("An image is already being generated".into());
        }

        self.cancel_flag.store(false, Ordering::SeqCst);
        let backend_name = backend.unwrap_or_else(|| "mlx".to_string());
        let result = if backend_name.eq_ignore_ascii_case("sdcpp")
            || backend_name.eq_ignore_ascii_case("stable-diffusion.cpp")
        {
            self.run_sdcpp_generation(&app, &params, binary_path.as_deref())
        } else {
            self.run_mlx_generation(&app, &params, binary_path.as_deref())
        };
        self.busy.store(false, Ordering::SeqCst);
        *self.child.lock() = None;
        result
    }

    fn run_sdcpp_generation(
        self: &Arc<Self>,
        app: &AppHandle,
        params: &ImageGenerateParams,
        binary_override: Option<&str>,
    ) -> Result<ImageGenerateResult, String> {
        let model = Path::new(&params.model_path);
        if !model.exists() {
            return Err(format!(
                "No Stable Diffusion model configured or file missing: {}",
                params.model_path
            ));
        }

        let binary = resolve_sd_binary(binary_override).ok_or_else(|| {
            "stable-diffusion.cpp binary (`sd`) not found. Install it (e.g. build from \
             https://github.com/leejet/stable-diffusion.cpp) or set the binary path in Settings."
                .to_string()
        })?;

        let out_dir = generated_images_dir();
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let ext = if params.format.eq_ignore_ascii_case("jpeg")
            || params.format.eq_ignore_ascii_case("jpg")
        {
            "jpg"
        } else {
            "png"
        };
        let output = out_dir.join(format!("{}.{}", params.job_id, ext));

        let seed = if params.seed < 0 {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut h = DefaultHasher::new();
            Instant::now().hash(&mut h);
            params.job_id.hash(&mut h);
            (h.finish() as i64).abs() % 2_147_483_647
        } else {
            params.seed
        };

        emit_progress(
            app,
            &params.job_id,
            2.0,
            None,
            Some(params.steps),
            Some("Starting Stable Diffusion...".into()),
        );

        let sampler = map_sampler(&params.sampler);
        let mut cmd = Command::new(&binary);
        cmd.arg("-m")
            .arg(&params.model_path)
            .arg("-p")
            .arg(&params.prompt)
            .arg("-o")
            .arg(&output)
            .arg("-W")
            .arg(params.width.to_string())
            .arg("-H")
            .arg(params.height.to_string())
            .arg("--steps")
            .arg(params.steps.to_string())
            .arg("--cfg-scale")
            .arg(params.cfg_scale.to_string())
            .arg("-s")
            .arg(seed.to_string())
            .arg("--sampling-method")
            .arg(sampler)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Be explicit about worker threads for more consistent performance.
        if let Ok(n) = thread::available_parallelism() {
            cmd.arg("-t").arg(n.get().to_string());
        }

        if let Some(neg) = &params.negative_prompt {
            if !neg.trim().is_empty() {
                cmd.arg("-n").arg(neg);
            }
        }

        log::info!("Starting image generation: {:?}", cmd);
        let start = Instant::now();

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start Stable Diffusion binary: {e}"))?;

        // Newer sd-cli builds may emit progress on either stderr or stdout.
        if let Some(stderr) = child.stderr.take() {
            spawn_progress_reader(
                stderr,
                app.clone(),
                params.job_id.clone(),
                params.steps,
                None,
            );
        }
        if let Some(stdout) = child.stdout.take() {
            spawn_progress_reader(
                stdout,
                app.clone(),
                params.job_id.clone(),
                params.steps,
                None,
            );
        }

        *self.child.lock() = Some(child);

        // Wait for process
        let status = {
            let mut guard = self.child.lock();
            if let Some(ref mut c) = *guard {
                c.wait().map_err(|e| e.to_string())?
            } else {
                return Err("Image generation process lost".into());
            }
        };

        if self.cancel_flag.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&output);
            return Err("Image generation cancelled".into());
        }

        if !status.success() {
            return Err(format!(
                "Stable Diffusion exited with status {status}. Check the model path and binary."
            ));
        }

        if !output.exists() {
            return Err("Image generation finished but no output file was created".into());
        }

        emit_progress(
            app,
            &params.job_id,
            100.0,
            Some(params.steps),
            Some(params.steps),
            Some("Done".into()),
        );

        Ok(ImageGenerateResult {
            image_path: output.to_string_lossy().into_owned(),
            width: params.width,
            height: params.height,
            seed,
            generation_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    fn run_mlx_generation(
        self: &Arc<Self>,
        app: &AppHandle,
        params: &ImageGenerateParams,
        binary_override: Option<&str>,
    ) -> Result<ImageGenerateResult, String> {
        let model_ref = match params.model_path.trim() {
            "sdxl" => "stabilityai/sdxl-turbo".to_string(),
            "sd" => "stabilityai/stable-diffusion-2-1-base".to_string(),
            other => other.to_string(),
        };

        let model_path = Path::new(&model_ref);
        if model_path.exists() {
            return Err(
                "Current MLX backend (mlx-examples/stable_diffusion) does not load arbitrary local model directories yet. Use one of: stabilityai/sdxl-turbo or stabilityai/stable-diffusion-2-1-base (aliases: sdxl, sd)."
                    .to_string(),
            );
        }

        if !model_ref.contains('/') {
            return Err(
                "MLX model must be a Hugging Face repo id. Supported now: stabilityai/sdxl-turbo or stabilityai/stable-diffusion-2-1-base (aliases: sdxl, sd)."
                    .to_string(),
            );
        }

        let python = resolve_python_binary(binary_override)
            .ok_or_else(|| "Python 3 not found. Install Python 3.10+ and ensure `python3` is on PATH".to_string())?;

        let out_dir = generated_images_dir();
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let ext = if params.format.eq_ignore_ascii_case("jpeg")
            || params.format.eq_ignore_ascii_case("jpg")
        {
            "jpg"
        } else {
            "png"
        };
        let output = out_dir.join(format!("{}.{}", params.job_id, ext));

        let seed = if params.seed < 0 {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut h = DefaultHasher::new();
            Instant::now().hash(&mut h);
            params.job_id.hash(&mut h);
            (h.finish() as i64).abs() % 2_147_483_647
        } else {
            params.seed
        };

        emit_progress(
            app,
            &params.job_id,
            3.0,
            None,
            Some(params.steps),
            Some("Starting MLX...".into()),
        );

        let script_path = ensure_mlx_script().map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&python);
        cmd.arg(script_path)
            .arg("--model")
            .arg(model_ref)
            .arg("--prompt")
            .arg(&params.prompt)
            .arg("--negative-prompt")
            .arg(params.negative_prompt.clone().unwrap_or_default())
            .arg("--width")
            .arg(params.width.to_string())
            .arg("--height")
            .arg(params.height.to_string())
            .arg("--steps")
            .arg(params.steps.to_string())
            .arg("--cfg")
            .arg(params.cfg_scale.to_string())
            .arg("--seed")
            .arg(seed.to_string())
            .arg("--output")
            .arg(&output)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(py_path) = resolve_mlx_pythonpath(binary_override) {
            let current = std::env::var("PYTHONPATH").unwrap_or_default();
            let joined = if current.is_empty() {
                py_path.display().to_string()
            } else {
                format!("{}:{}", py_path.display(), current)
            };
            cmd.env("PYTHONPATH", joined);
        }

        log::info!("Starting MLX image generation: {:?}", cmd);
        let start = Instant::now();
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start MLX Python runner: {e}"))?;

        let stderr_lines = Arc::new(parking_lot::Mutex::new(Vec::<String>::new()));

        if let Some(stderr) = child.stderr.take() {
            spawn_progress_reader(
                stderr,
                app.clone(),
                params.job_id.clone(),
                params.steps,
                Some(stderr_lines.clone()),
            );
        }
        if let Some(stdout) = child.stdout.take() {
            spawn_progress_reader(
                stdout,
                app.clone(),
                params.job_id.clone(),
                params.steps,
                None,
            );
        }

        *self.child.lock() = Some(child);

        let status = {
            let mut guard = self.child.lock();
            if let Some(ref mut c) = *guard {
                c.wait().map_err(|e| e.to_string())?
            } else {
                return Err("MLX generation process lost".into());
            }
        };

        if self.cancel_flag.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&output);
            return Err("Image generation cancelled".into());
        }

        if !status.success() {
            let detail = {
                let lines = stderr_lines.lock();
                if lines.is_empty() {
                    String::new()
                } else {
                    let mut tail: Vec<String> = lines.iter().rev().take(6).cloned().collect();
                    tail.reverse();
                    format!(" Last MLX stderr lines: {}", tail.join(" | "))
                }
            };
            return Err(format!(
                "MLX generation exited with status {status}. Ensure Python dependencies are installed and model path is MLX-compatible.{detail}"
            ));
        }

        if !output.exists() {
            return Err("MLX generation finished but no output file was created".into());
        }

        emit_progress(
            app,
            &params.job_id,
            100.0,
            Some(params.steps),
            Some(params.steps),
            Some("Done".into()),
        );

        Ok(ImageGenerateResult {
            image_path: output.to_string_lossy().into_owned(),
            width: params.width,
            height: params.height,
            seed,
            generation_time_ms: start.elapsed().as_millis() as u64,
        })
    }
}

fn emit_progress(
    app: &AppHandle,
    job_id: &str,
    progress: f64,
    step: Option<u32>,
    total_steps: Option<u32>,
    message: Option<String>,
) {
    let _ = app.emit(
        "image-gen-progress",
        ImageGenProgressEvent {
            job_id: job_id.to_string(),
            progress,
            step,
            total_steps,
            message,
        },
    );
}

fn spawn_progress_reader<R: std::io::Read + Send + 'static>(
    stream: R,
    app: AppHandle,
    job_id: String,
    total: u32,
    stderr_sink: Option<Arc<parking_lot::Mutex<Vec<String>>>>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().flatten() {
            if let Some(ref sink) = stderr_sink {
                sink.lock().push(line.clone());
            }
            log::debug!("sd: {line}");
            if let Some((p, msg)) = parse_mlx_progress_line(&line) {
                let step = ((p / 100.0) * total as f64)
                    .round()
                    .clamp(0.0, total as f64) as u32;
                emit_progress(&app, &job_id, p, Some(step), Some(total), Some(msg));
                continue;
            }
            if let Some((step, progress)) = parse_progress_line(&line, total) {
                emit_progress(
                    &app,
                    &job_id,
                    progress,
                    Some(step),
                    Some(total),
                    Some(format!("Step {step}/{total}")),
                );
            }
        }
    });
}

fn parse_mlx_progress_line(line: &str) -> Option<(f64, String)> {
    if !line.starts_with("MLX_PROGRESS:") {
        return None;
    }
    let rest = &line["MLX_PROGRESS:".len()..];
    let mut parts = rest.splitn(2, ':');
    let pct = parts.next()?.trim().parse::<f64>().ok()?.clamp(0.0, 100.0);
    let msg = parts.next().unwrap_or("Generating").trim().to_string();
    Some((pct, msg))
}

/// Parse progress from stable-diffusion.cpp output lines.
/// Handles forms like "5/20", "step 5", or "23.4%".
fn parse_progress_line(line: &str, total_steps: u32) -> Option<(u32, f64)> {
    // Match "N/M" patterns
    for part in line.split_whitespace() {
        if let Some((a, b)) = part.split_once('/') {
            if let (Ok(step), Ok(total)) = (a.parse::<u32>(), b.parse::<u32>()) {
                if total > 0 && step <= total {
                    let progress = (step as f64 / total as f64) * 95.0 + 3.0;
                    return Some((step, progress.min(98.0)));
                }
            }
        }
    }

    // Match percentage forms like "23%" or "23.4%".
    if let Some(idx) = line.find('%') {
        let left = &line[..idx];
        let pct_text_rev: String = left
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();

        if !pct_text_rev.is_empty() {
            let pct_text: String = pct_text_rev.chars().rev().collect();
            if let Ok(percent) = pct_text.parse::<f64>() {
                if total_steps > 0 {
                    let clamped = percent.clamp(0.0, 100.0);
                    let step = ((clamped / 100.0) * total_steps as f64)
                        .round()
                        .clamp(0.0, total_steps as f64) as u32;
                    return Some((step, clamped));
                }
            }
        }
    }

    // Fallback: "step N"
    if let Some(idx) = line.to_ascii_lowercase().find("step") {
        let rest = &line[idx + 4..];
        let num: String = rest
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(step) = num.parse::<u32>() {
            if total_steps > 0 {
                let progress = (step as f64 / total_steps as f64) * 95.0 + 3.0;
                return Some((step.min(total_steps), progress.min(98.0)));
            }
        }
    }

    None
}

fn map_sampler(name: &str) -> String {
    match name.to_ascii_lowercase().as_str() {
        "euler" => "euler".into(),
        "euler_a" | "euler_ancestral" => "euler_a".into(),
        "heun" => "heun".into(),
        "dpm2" => "dpm2".into(),
        "dpm++2m" | "dpmpp2m" => "dpm++2m".into(),
        "dpm++2s_a" | "dpmpp2s_a" => "dpm++2s_a".into(),
        "lms" => "lms".into(),
        "ddim" => "ddim".into(),
        _ => "euler_a".into(),
    }
}

pub fn generated_images_dir() -> PathBuf {
    let dir = app_support_dir().join("generated_images");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn project_root_dir() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    if cwd.join("package.json").exists() {
        return Some(cwd);
    }

    let parent = cwd.parent()?.to_path_buf();
    if parent.join("package.json").exists() {
        return Some(parent);
    }

    None
}

pub fn image_models_dir() -> PathBuf {
    let dir = project_root_dir()
        .map(|root| root.join("models").join("image"))
        .unwrap_or_else(|| app_support_dir().join("models").join("image"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn list_image_models() -> Vec<String> {
    let dir = image_models_dir();
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.join("model_index.json").exists() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        names.push(name.to_string());
                    }
                }
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if matches!(ext.as_str(), "safetensors" | "ckpt" | "gguf") {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    names.push(name.to_string());
                }
            }
        }
    }
    names.sort();
    names
}

fn resolve_sd_binary(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = configured {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for c in [
                dir.join("sd"),
                dir.join("sd-cli"),
                dir.join("../Resources/sd"),
                dir.join("resources/sd"),
            ] {
                if c.exists() {
                    return Some(c);
                }
            }
        }
    }

    let home = dirs::home_dir()
        .map(|h| h.display().to_string())
        .unwrap_or_default();

    let candidates = [
        "/opt/homebrew/bin/sd".to_string(),
        "/opt/homebrew/bin/sd-cli".to_string(),
        "/usr/local/bin/sd".to_string(),
        format!("{home}/.local/bin/sd"),
        format!("{home}/stable-diffusion.cpp/build/bin/sd"),
        format!("{home}/stable-diffusion.cpp/build/bin/sd-cli"),
        format!("{home}/git/stable-diffusion.cpp/build/bin/sd"),
        format!("{home}/git/stable-diffusion.cpp/build/bin/sd-cli"),
    ];

    for c in candidates {
        let p = PathBuf::from(&c);
        if p.exists() {
            return Some(p);
        }
    }

    which("sd").or_else(|| which("sd-cli"))
}

fn resolve_python_binary(configured: Option<&str>) -> Option<PathBuf> {
    fn python_from_dir(dir: &Path) -> Option<PathBuf> {
        let direct = dir.join(".venv").join("bin").join("python");
        if direct.exists() {
            return Some(direct);
        }

        let nested = dir
            .join("stable_diffusion")
            .join(".venv")
            .join("bin")
            .join("python");
        if nested.exists() {
            return Some(nested);
        }

        None
    }

    if let Some(p) = configured {
        let path = PathBuf::from(p);
        if path.exists() {
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("python"))
                .unwrap_or(false)
            {
                return Some(path);
            }

            if path.is_dir() {
                if let Some(py) = python_from_dir(&path) {
                    return Some(py);
                }
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        for dir in [
            home.join("git").join("mlx-examples"),
            home.join("git").join("mlx-examples").join("stable_diffusion"),
            home.join("mlx-examples"),
            home.join("mlx-examples").join("stable_diffusion"),
        ] {
            if let Some(py) = python_from_dir(&dir) {
                return Some(py);
            }
        }
    }

    which("python3").or_else(|| which("python"))
}

fn resolve_mlx_pythonpath(configured: Option<&str>) -> Option<PathBuf> {
    fn normalize_mlx_pythonpath(path: &Path) -> Option<PathBuf> {
        if path.is_dir() {
            // /.../mlx-examples/stable_diffusion (project dir)
            if path.join("stable_diffusion").join("__init__.py").exists()
                && path.join("requirements.txt").exists()
            {
                return Some(path.to_path_buf());
            }

            // /.../mlx-examples (repo root)
            let child = path.join("stable_diffusion");
            if child.join("stable_diffusion").join("__init__.py").exists()
                && child.join("requirements.txt").exists()
            {
                return Some(child);
            }
        }
        None
    }

    if let Some(p) = configured {
        let path = PathBuf::from(p);
        if let Some(py_path) = normalize_mlx_pythonpath(&path) {
            return Some(py_path);
        }
        if path.is_file() {
            if let Some(parent) = path.parent() {
                if let Some(py_path) = normalize_mlx_pythonpath(parent) {
                    return Some(py_path);
                }
            }
        }
    }

    let home = dirs::home_dir()?;
    let candidates = [
        home.join("git").join("mlx-examples"),
        home.join("git").join("mlx-examples").join("stable_diffusion"),
        home.join("mlx-examples"),
        home.join("mlx-examples").join("stable_diffusion"),
    ];
    for candidate in candidates {
        if let Some(py_path) = normalize_mlx_pythonpath(&candidate) {
            return Some(py_path);
        }
    }
    None
}

fn ensure_mlx_script() -> std::io::Result<PathBuf> {
    let dir = app_support_dir().join("scripts");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("mlx_generate.py");
    std::fs::write(&path, MLX_GENERATE_PY)?;
    Ok(path)
}

const MLX_GENERATE_PY: &str = r#"#!/usr/bin/env python3
import argparse
import sys
import numpy as np
from PIL import Image


def progress(pct, msg):
    print(f"MLX_PROGRESS:{pct}:{msg}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Generate image via MLX Stable Diffusion")
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--cfg", type=float, default=5.0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        import mlx.core as mx
        try:
            from stable_diffusion import StableDiffusionXL
        except Exception:
            from stable_diffusion.stable_diffusion import StableDiffusionXL
    except Exception as e:
        print(
            "MLX_ERROR: Missing MLX dependencies. Install mlx + mlx-examples and ensure "
            "PYTHONPATH includes mlx-examples.",
            file=sys.stderr,
        )
        print(f"MLX_ERROR_DETAIL: {e}", file=sys.stderr)
        return 2

    progress(5, "Loading MLX model")
    sd = StableDiffusionXL(args.model, float16=True)

    latent_w = max(8, args.width // 8)
    latent_h = max(8, args.height // 8)
    steps = max(1, int(args.steps))

    progress(10, "Generating latents")
    latents = sd.generate_latents(
        args.prompt,
        n_images=1,
        num_steps=steps,
        cfg_weight=float(args.cfg),
        negative_text=args.negative_prompt,
        latent_size=(latent_h, latent_w),
        seed=int(args.seed),
    )

    x_t = None
    for i, sample in enumerate(latents, start=1):
        x_t = sample
        mx.eval(x_t)
        pct = 10 + int((i / steps) * 80)
        progress(min(pct, 90), f"Step {i}/{steps}")

    if x_t is None:
        print("MLX_ERROR: No latent produced", file=sys.stderr)
        return 3

    progress(92, "Decoding image")
    decoded = sd.decode(x_t)
    mx.eval(decoded)

    x = decoded[0]
    x = (x * 255).astype(mx.uint8)
    arr = np.array(x)
    im = Image.fromarray(arr)
    im.save(args.output)
    progress(100, "Done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"#;

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

/// Reveal a file in Finder (macOS).
pub fn reveal_in_finder(path: &str) -> Result<(), String> {
    Command::new("open")
        .args(["-R", path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Copy a generated image to a user-chosen destination.
pub fn copy_image_file(source: &str, destination: &str) -> Result<(), String> {
    std::fs::copy(source, destination).map_err(|e| e.to_string())?;
    Ok(())
}
