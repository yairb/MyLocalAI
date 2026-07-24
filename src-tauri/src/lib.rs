mod commands;
mod db;
mod llama;
mod models;

use commands::AppState;
use db::Database;
use llama::{db_path, models_dir, LlamaManager};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure app support dirs exist early
    let _ = std::fs::create_dir_all(models_dir());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let database = Database::open(db_path()).expect("failed to open database");
            let llama = LlamaManager::new();

            app.manage(AppState {
                db: database,
                llama,
            });

            // Soft launch: try starting engine without blocking UI
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Some(state) = handle.try_state::<AppState>() {
                    if let Ok(settings) = state.db.get_settings() {
                        let _ = state.llama.start(&settings);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<AppState>() {
                    // Don't kill external servers the user may have started
                    // Only stop if we own the child process
                    state.llama.stop();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_conversations,
            commands::create_conversation,
            commands::update_conversation,
            commands::delete_conversation,
            commands::touch_conversation,
            commands::list_messages,
            commands::add_message,
            commands::update_message_content,
            commands::list_characters,
            commands::create_character,
            commands::update_character,
            commands::delete_character,
            commands::get_settings,
            commands::update_settings,
            commands::get_engine_status,
            commands::start_engine,
            commands::stop_engine,
            commands::pick_model_file,
            commands::get_models_dir,
            commands::list_local_models,
            commands::list_memories,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
