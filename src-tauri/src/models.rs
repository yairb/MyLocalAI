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
        }
    }
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
