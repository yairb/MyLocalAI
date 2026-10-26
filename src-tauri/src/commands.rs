use crate::db::Database;
use crate::image_gen::{
    avatars_dir, copy_image_file, image_models_dir, list_image_models, reveal_in_finder,
    ImageGenManager,
};
use crate::llama::{list_gguf_models, models_dir, LlamaManager};
use crate::models::*;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub db: Database,
    pub llama: Arc<LlamaManager>,
    pub image_gen: Arc<ImageGenManager>,
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
    character_id: Option<String>,
) -> Result<Message, String> {
    state
        .db
        .add_message(&conversation_id, &role, &content, character_id)
}

#[tauri::command]
pub fn list_participants(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<String>, String> {
    state.db.list_participants(&conversation_id)
}

#[tauri::command]
pub fn set_participants(
    state: State<'_, AppState>,
    conversation_id: String,
    character_ids: Vec<String>,
) -> Result<(), String> {
    state.db.set_participants(&conversation_id, character_ids)
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
    let avatar_path = state.db.delete_character(&id)?;
    if let Some(path) = avatar_path {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub fn get_character(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Character>, String> {
    state.db.get_character(&id)
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
pub fn list_memories(
    state: State<'_, AppState>,
    character_id: Option<String>,
) -> Result<Vec<Memory>, String> {
    state.db.list_memories(character_id)
}

#[tauri::command]
pub fn create_memory(
    state: State<'_, AppState>,
    input: CreateMemoryInput,
) -> Result<Memory, String> {
    state.db.create_memory(input)
}

#[tauri::command]
pub fn update_memory(state: State<'_, AppState>, input: UpdateMemoryInput) -> Result<(), String> {
    state.db.update_memory(input)
}

#[tauri::command]
pub fn delete_memory(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_memory(&id)
}

#[tauri::command]
pub fn delete_memories_for_character(
    state: State<'_, AppState>,
    character_id: String,
) -> Result<(), String> {
    state.db.delete_memories_for_character(&character_id)
}

#[tauri::command]
pub fn get_conversation_summary(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Option<ConversationSummary>, String> {
    state.db.get_conversation_summary(&conversation_id)
}

#[tauri::command]
pub fn upsert_conversation_summary(
    state: State<'_, AppState>,
    input: UpsertSummaryInput,
) -> Result<Option<ConversationSummary>, String> {
    state.db.upsert_conversation_summary(input)
}

#[tauri::command]
pub fn clear_conversation_summary(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state.db.clear_conversation_summary(&conversation_id)
}

#[tauri::command]
pub fn count_images_of_kind(
    state: State<'_, AppState>,
    conversation_id: String,
    kind: String,
) -> Result<i64, String> {
    state.db.count_images_of_kind(&conversation_id, &kind)
}

// ── Avatars ─────────────────────────────────

/// Promotes a freshly generated image out of generated_images/ into
/// avatars/<character_id>-<variant>.<ext>. The variant in the filename is what stops
/// the webview serving a cached copy of the previous face after a re-roll.
#[tauri::command]
pub fn save_character_avatar(
    source_path: String,
    character_id: String,
    variant: i64,
) -> Result<String, String> {
    let ext = std::path::Path::new(&source_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();

    let dir = avatars_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{character_id}-{variant}.{ext}"));
    let dest_str = dest.to_string_lossy().to_string();

    copy_image_file(&source_path, &dest_str)?;
    let _ = std::fs::remove_file(&source_path);
    Ok(dest_str)
}

#[tauri::command]
pub fn delete_character_avatar(path: String) -> Result<(), String> {
    let _ = std::fs::remove_file(path);
    Ok(())
}

// ── Image generation ───────────────────────────────────────────

#[tauri::command]
pub fn pick_image_model_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_dir = image_models_dir();
    let file = app
        .dialog()
        .file()
        .add_filter("Stable Diffusion models", &["safetensors", "ckpt", "gguf"])
        .set_directory(default_dir)
        .set_title("Select Stable Diffusion model")
        .blocking_pick_file();

    Ok(file
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn get_image_models_dir() -> String {
    image_models_dir().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn list_local_image_models() -> Vec<String> {
    list_image_models()
}

#[tauri::command]
pub async fn generate_image(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    params: ImageGenerateParams,
) -> Result<ImageGenerateResult, String> {
    let settings = state.db.get_settings()?;
    let manager = Arc::clone(&state.image_gen);
    let binary = settings.image_binary_path.clone();
    let backend = Some(settings.image_backend.clone());

    // Run on a blocking thread so the async runtime stays free
    tauri::async_runtime::spawn_blocking(move || manager.generate(app, params, binary, backend))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_image_generation(state: State<'_, AppState>) -> Result<(), String> {
    state.image_gen.cancel();
    Ok(())
}

#[tauri::command]
pub fn is_image_generating(state: State<'_, AppState>) -> bool {
    state.image_gen.is_busy()
}

#[tauri::command]
pub fn create_generated_image(
    state: State<'_, AppState>,
    input: CreateGeneratedImageInput,
) -> Result<GeneratedImage, String> {
    state.db.create_generated_image(input)
}

#[tauri::command]
pub fn delete_message(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let image_path = state.db.delete_message(&id)?;
    if let Some(path) = image_path {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_image_in_finder(path: String) -> Result<(), String> {
    reveal_in_finder(&path)
}

#[tauri::command]
pub fn save_image_as(app: tauri::AppHandle, source_path: String) -> Result<Option<String>, String> {
    let default_name = std::path::Path::new(&source_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image.png");

    let file = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .set_title("Save image")
        .blocking_save_file();

    match file {
        Some(fp) => {
            let dest = fp
                .into_path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned();
            copy_image_file(&source_path, &dest)?;
            Ok(Some(dest))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn search_conversations(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<Conversation>, String> {
    state.db.search_conversations(&query)
}
