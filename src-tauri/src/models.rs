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
    /// Which character said it. None for user messages, and for assistant replies
    /// written before group chats existed.
    #[serde(default)]
    pub character_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<GeneratedImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExampleExchange {
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub character: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    pub created_at: String,
    pub updated_at: Option<String>,

    // Identity
    #[serde(default)]
    pub pronouns: String,
    #[serde(default)]
    pub backstory: String,

    // Personality
    #[serde(default)]
    pub personality_traits: Vec<String>,
    #[serde(default)]
    pub strengths: String,
    #[serde(default)]
    pub weaknesses: String,
    #[serde(default)]
    pub quirks: String,
    #[serde(default)]
    pub core_values: String,
    #[serde(default)]
    pub interests: Vec<String>,

    // Voice
    #[serde(default)]
    pub speaking_style: String,
    #[serde(default = "default_response_length")]
    pub response_length: String,
    #[serde(default = "default_emoji_usage")]
    pub emoji_usage: String,

    // Relationship and scene
    #[serde(default)]
    pub relationship_to_user: String,
    #[serde(default)]
    pub user_alias: String,
    #[serde(default)]
    pub scenario: String,
    #[serde(default)]
    pub greeting: String,
    #[serde(default)]
    pub example_dialogue: Vec<ExampleExchange>,
    #[serde(default)]
    pub boundaries: String,

    // Memory
    #[serde(default = "default_true")]
    pub memory_enabled: bool,
    #[serde(default)]
    pub key_memories: String,

    // Appearance and images
    #[serde(default)]
    pub appearance_prompt: String,
    #[serde(default)]
    pub appearance_negative_prompt: String,
    #[serde(default)]
    pub appearance_seed: Option<i64>,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default)]
    pub avatar_variant: i64,
    #[serde(default = "default_true")]
    pub can_send_images: bool,
    #[serde(default)]
    pub selfie_style_prompt: String,

    // Generation overrides
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<i64>,
    #[serde(default)]
    pub prompt_override_enabled: bool,
    /// How much of the scene they narrate: plain | actions | story.
    #[serde(default = "default_narration_style")]
    pub narration_style: String,
}

/// Everything a character can be created with. `name` is the only required field.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateCharacterInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default)]
    pub pronouns: String,
    #[serde(default)]
    pub backstory: String,
    #[serde(default)]
    pub personality_traits: Vec<String>,
    #[serde(default)]
    pub strengths: String,
    #[serde(default)]
    pub weaknesses: String,
    #[serde(default)]
    pub quirks: String,
    #[serde(default)]
    pub core_values: String,
    #[serde(default)]
    pub interests: Vec<String>,
    #[serde(default)]
    pub speaking_style: String,
    #[serde(default = "default_response_length")]
    pub response_length: String,
    #[serde(default = "default_emoji_usage")]
    pub emoji_usage: String,
    #[serde(default)]
    pub relationship_to_user: String,
    #[serde(default)]
    pub user_alias: String,
    #[serde(default)]
    pub scenario: String,
    #[serde(default)]
    pub greeting: String,
    #[serde(default)]
    pub example_dialogue: Vec<ExampleExchange>,
    #[serde(default)]
    pub boundaries: String,
    #[serde(default = "default_true")]
    pub memory_enabled: bool,
    #[serde(default)]
    pub key_memories: String,
    #[serde(default)]
    pub appearance_prompt: String,
    #[serde(default)]
    pub appearance_negative_prompt: String,
    #[serde(default)]
    pub appearance_seed: Option<i64>,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default)]
    pub avatar_variant: i64,
    #[serde(default = "default_true")]
    pub can_send_images: bool,
    #[serde(default)]
    pub selfie_style_prompt: String,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<i64>,
    #[serde(default)]
    pub prompt_override_enabled: bool,
    #[serde(default = "default_narration_style")]
    pub narration_style: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateCharacterInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub temperature: Option<f64>,
    pub pronouns: Option<String>,
    pub backstory: Option<String>,
    pub personality_traits: Option<Vec<String>>,
    pub strengths: Option<String>,
    pub weaknesses: Option<String>,
    pub quirks: Option<String>,
    pub core_values: Option<String>,
    pub interests: Option<Vec<String>>,
    pub speaking_style: Option<String>,
    pub response_length: Option<String>,
    pub emoji_usage: Option<String>,
    pub relationship_to_user: Option<String>,
    pub user_alias: Option<String>,
    pub scenario: Option<String>,
    pub greeting: Option<String>,
    pub example_dialogue: Option<Vec<ExampleExchange>>,
    pub boundaries: Option<String>,
    pub memory_enabled: Option<bool>,
    pub key_memories: Option<String>,
    pub appearance_prompt: Option<String>,
    pub appearance_negative_prompt: Option<String>,
    pub appearance_seed: Option<i64>,
    pub avatar_path: Option<String>,
    pub avatar_variant: Option<i64>,
    pub can_send_images: Option<bool>,
    pub selfie_style_prompt: Option<String>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<i64>,
    pub prompt_override_enabled: Option<bool>,
    pub narration_style: Option<String>,
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

    // Who the characters are talking to
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub user_persona: String,

    // Memory
    #[serde(default = "default_true")]
    pub memory_enabled: bool,
    #[serde(default = "default_memory_max_facts")]
    pub memory_max_facts: i64,

    #[serde(default = "default_image_style_suffix")]
    pub image_style_suffix: String,
    #[serde(default = "default_avatar_resolution")]
    pub avatar_resolution: String,

    // Group conversations
    #[serde(default = "default_group_replies")]
    pub group_replies_per_turn: i64,
}

fn default_temperature() -> f64 {
    0.7
}
fn default_response_length() -> String {
    "medium".into()
}
fn default_emoji_usage() -> String {
    "rare".into()
}
fn default_narration_style() -> String {
    "story".into()
}
fn default_memory_max_facts() -> i64 {
    200
}
fn default_image_style_suffix() -> String {
    "amateur phone photo, natural lighting, candid, shallow depth of field, photorealistic".into()
}
fn default_avatar_resolution() -> String {
    "512x512".into()
}
fn default_group_replies() -> i64 {
    1
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
            user_name: String::new(),
            user_persona: String::new(),
            memory_enabled: true,
            memory_max_facts: default_memory_max_facts(),
            image_style_suffix: default_image_style_suffix(),
            avatar_resolution: default_avatar_resolution(),
            group_replies_per_turn: default_group_replies(),
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
    #[serde(default)]
    pub caption: String,
    #[serde(default = "default_image_kind")]
    pub kind: String,
}

fn default_image_kind() -> String {
    "user_request".into()
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
    #[serde(default)]
    pub caption: String,
    #[serde(default = "default_image_kind")]
    pub kind: String,
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

/// A durable fact the character remembers about the user, across conversations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub character_id: Option<String>,
    pub conversation_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub keywords: String,
    pub importance: f64,
    pub pinned: bool,
    pub source_message_id: Option<String>,
    pub hits: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_accessed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMemoryInput {
    #[serde(default)]
    pub character_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default = "default_memory_kind")]
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub keywords: String,
    #[serde(default = "default_importance")]
    pub importance: f64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub source_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMemoryInput {
    pub id: String,
    pub content: Option<String>,
    pub keywords: Option<String>,
    pub kind: Option<String>,
    pub importance: Option<f64>,
    pub pinned: Option<bool>,
    pub hits: Option<i64>,
    pub touch_access: Option<bool>,
}

fn default_memory_kind() -> String {
    "fact".into()
}
fn default_importance() -> f64 {
    0.5
}

/// Rolling background summary of everything older than the live message window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub conversation_id: String,
    pub summary: String,
    pub summarized_up_to_message_id: Option<String>,
    pub summarized_up_to_created_at: Option<String>,
    pub message_count: i64,
    pub token_estimate: i64,
    pub version: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertSummaryInput {
    pub conversation_id: String,
    pub summary: String,
    pub summarized_up_to_message_id: Option<String>,
    pub summarized_up_to_created_at: Option<String>,
    pub message_count: i64,
    pub token_estimate: i64,
    /// Version the caller read before running the LLM. The write is rejected when
    /// the stored row has moved on, so a slow background run never clobbers a newer one.
    pub expected_version: Option<i64>,
}
