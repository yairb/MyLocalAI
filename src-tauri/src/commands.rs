use crate::db::Database;
use crate::llama::{list_gguf_models, models_dir, LlamaManager};
use crate::models::*;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub db: Database,
    pub llama: Arc<LlamaManager>,
}

#[tauri::command]
pub fn list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    state.db.list_conversations()
}

#[tauri::command]
pub fn create_conversation(
    state: State<'_, AppState>,
    title: String,
    character_id: Option<String>,
) -> Result<Conversation, String> {
    state.db.create_conversation(title, character_id)
}

#[tauri::command]
pub fn update_conversation(
    state: State<'_, AppState>,
    id: String,
    patch: ConversationPatch,
) -> Result<Conversation, String> {
    state.db.update_conversation(&id, patch)
}

#[tauri::command]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_conversation(&id)
}

#[tauri::command]
pub fn touch_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.touch_conversation(&id)
}

#[tauri::command]
pub fn list_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    state.db.list_messages(&conversation_id)
}

#[tauri::command]
pub fn add_message(
    state: State<'_, AppState>,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<Message, String> {
    state.db.add_message(&conversation_id, &role, &content)
}

#[tauri::command]
pub fn update_message_content(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), String> {
    state.db.update_message_content(&id, &content)
}

#[tauri::command]
pub fn list_characters(state: State<'_, AppState>) -> Result<Vec<Character>, String> {
    state.db.list_characters()
}

#[tauri::command]
pub fn create_character(
    state: State<'_, AppState>,
    input: CreateCharacterInput,
) -> Result<Character, String> {
    state.db.create_character(input)
}

#[tauri::command]
pub fn update_character(
    state: State<'_, AppState>,
    input: UpdateCharacterInput,
) -> Result<Character, String> {
    state.db.update_character(input)
}

#[tauri::command]
pub fn delete_character(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_character(&id)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.db.get_settings()
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    patch: Value,
) -> Result<AppSettings, String> {
    state.db.update_settings(patch)
}

#[tauri::command]
pub fn get_engine_status(state: State<'_, AppState>) -> EngineStatusResponse {
    state.llama.status()
}

#[tauri::command]
pub fn start_engine(state: State<'_, AppState>) -> Result<EngineStatusResponse, String> {
    let settings = state.db.get_settings()?;
    Ok(state.llama.start(&settings))
}

#[tauri::command]
pub fn stop_engine(state: State<'_, AppState>) -> Result<(), String> {
    state.llama.stop();
    Ok(())
}

#[tauri::command]
pub fn pick_model_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("GGUF Models", &["gguf"])
        .set_title("Select GGUF model")
        .blocking_pick_file();

    Ok(file.and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn get_models_dir() -> String {
    models_dir().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn list_local_models() -> Vec<String> {
    list_gguf_models()
}

#[tauri::command]
pub fn list_memories(state: State<'_, AppState>) -> Result<Vec<Memory>, String> {
    state.db.list_memories()
}
