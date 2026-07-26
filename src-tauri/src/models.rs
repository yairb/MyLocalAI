use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub character_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<GeneratedImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCharacterInput {
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub temperature: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCharacterInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationPatch {
    pub title: Option<String>,
    pub character_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub model_path: Option<String>,
    pub model_name: Option<String>,
    pub context_size: i64,
    pub gpu_layers: i64,
    pub temperature: f64,
    pub top_p: f64,
    pub max_tokens: i64,
    pub active_character_id: Option<String>,
    pub llama_host: String,
    pub llama_port: i64,
    pub llama_binary_path: Option<String>,

    // Image generation
    #[serde(default)]
    pub image_model_path: Option<String>,
    #[serde(default)]
    pub image_model_name: Option<String>,
    #[serde(default = "default_image_resolution")]
    pub image_resolution: String,
    #[serde(default = "default_image_steps")]
    pub image_steps: i64,
    #[serde(default = "default_image_cfg")]
    pub image_cfg_scale: f64,
    #[serde(default = "default_image_sampler")]
    pub image_sampler: String,
    #[serde(default = "default_image_seed")]
    pub image_seed: i64,
    #[serde(default = "default_true")]
    pub image_random_seed: bool,
    #[serde(default = "default_true")]
    pub image_enhance_prompt: bool,
    #[serde(default = "default_image_format")]
    pub image_format: String,
    #[serde(default = "default_image_backend")]
    pub image_backend: String,
    #[serde(default)]
    pub image_binary_path: Option<String>,
    #[serde(default = "default_negative_prompt")]
    pub image_negative_prompt: String,
}

fn default_image_resolution() -> String {
    "512x512".into()
}
fn default_image_steps() -> i64 {
    20
}
fn default_image_cfg() -> f64 {
    7.0
}
fn default_image_sampler() -> String {
    "euler_a".into()
}
fn default_image_seed() -> i64 {
    -1
}
fn default_true() -> bool {
    true
}
fn default_image_format() -> String {
    "png".into()
}
fn default_image_backend() -> String {
    "mlx".into()
}
fn default_negative_prompt() -> String {
    "blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, text".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            model_path: None,
            model_name: None,
            context_size: 4096,
            gpu_layers: 99,
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 2048,
            active_character_id: None,
            llama_host: "127.0.0.1".into(),
            llama_port: 8080,
            llama_binary_path: None,
            image_model_path: None,
            image_model_name: None,
            image_resolution: default_image_resolution(),
            image_steps: default_image_steps(),
            image_cfg_scale: default_image_cfg(),
            image_sampler: default_image_sampler(),
            image_seed: default_image_seed(),
            image_random_seed: true,
            image_enhance_prompt: true,
            image_format: default_image_format(),
            image_backend: default_image_backend(),
            image_binary_path: None,
            image_negative_prompt: default_negative_prompt(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    pub id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub original_prompt: String,
    pub enhanced_prompt: String,
    pub image_path: String,
    pub width: i64,
    pub height: i64,
    pub seed: i64,
    pub sampler: String,
    pub steps: i64,
    pub cfg: f64,
    pub created_at: String,
    pub generation_time_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGeneratedImageInput {
    pub conversation_id: String,
    pub message_id: String,
    pub original_prompt: String,
    pub enhanced_prompt: String,
    pub image_path: String,
    pub width: i64,
    pub height: i64,
    pub seed: i64,
    pub sampler: String,
    pub steps: i64,
    pub cfg: f64,
    pub generation_time_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerateParams {
    pub job_id: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub cfg_scale: f64,
    pub seed: i64,
    pub sampler: String,
    pub model_path: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerateResult {
    pub image_path: String,
    pub width: u32,
    pub height: u32,
    pub seed: i64,
    pub generation_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenProgressEvent {
    pub job_id: String,
    pub progress: f64,
    pub step: Option<u32>,
    pub total_steps: Option<u32>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatusResponse {
    pub status: String,
    pub message: String,
    pub progress: f64,
    pub model_loaded: Option<String>,
    pub error: Option<String>,
}

/// Future-ready: long-term memory entries (schema exists, API minimal).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub content: String,
    pub source_message_id: Option<String>,
    pub importance: f64,
    pub created_at: String,
    pub last_accessed_at: Option<String>,
}
