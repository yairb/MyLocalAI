use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        db.seed_defaults()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS characters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                system_prompt TEXT NOT NULL,
                temperature REAL NOT NULL DEFAULT 0.7,
                created_at TEXT NOT NULL,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON messages(conversation_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_conversations_updated
                ON conversations(updated_at DESC);

            -- Future-ready long-term memory table
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                source_message_id TEXT,
                importance REAL NOT NULL DEFAULT 0.5,
                created_at TEXT NOT NULL,
                last_accessed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| e.to_string())
    }

    fn seed_defaults(&self) -> Result<(), String> {
        let count: i64 = {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row("SELECT COUNT(*) FROM characters", [], |r| r.get(0))
                .map_err(|e| e.to_string())?
        };

        if count == 0 {
            let defaults = [
                (
                    "Default Assistant",
                    "A helpful, clear, and concise AI assistant.",
                    "You are a helpful AI assistant running locally on the user's Mac. Be clear, accurate, and concise. Use markdown when it improves readability. If you are unsure, say so.",
                    0.7,
                ),
                (
                    "Friendly Companion",
                    "Warm, conversational, and supportive.",
                    "You are a friendly companion named Alex. You are warm, encouraging, and conversational. You remember personal details the user shares in the current conversation and respond with empathy. Keep replies natural and human.",
                    0.85,
                ),
                (
                    "Coding Expert",
                    "Senior engineer focused on clean, practical code.",
                    "You are an expert software engineer. Prefer practical, production-quality solutions. Use clear code examples with language tags. Explain trade-offs briefly. When debugging, reason step by step. Prefer modern best practices.",
                    0.4,
                ),
                (
                    "Creative Writer",
                    "Imaginative storyteller and writing partner.",
                    "You are a creative writing partner. Help with stories, poems, scripts, and brainstorming. Be imaginative, vivid, and collaborative. Offer alternatives when asked. Match the tone and style the user is aiming for.",
                    0.95,
                ),
            ];

            let mut first_id: Option<String> = None;
            for (name, desc, prompt, temp) in defaults {
                let c = self.create_character(CreateCharacterInput {
                    name: name.into(),
                    description: desc.into(),
                    system_prompt: prompt.into(),
                    temperature: temp,
                })?;
                if first_id.is_none() {
                    first_id = Some(c.id);
                }
            }

            if let Some(id) = first_id {
                let mut settings = self.get_settings()?;
                if settings.active_character_id.is_none() {
                    settings.active_character_id = Some(id);
                    self.save_settings(&settings)?;
                }
            }
        }

        Ok(())
    }

    // ── Conversations ──────────────────────────────────────────

    pub fn list_conversations(&self) -> Result<Vec<Conversation>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, character_id, created_at, updated_at
                 FROM conversations ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    character_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn create_conversation(
        &self,
        title: String,
        character_id: Option<String>,
    ) -> Result<Conversation, String> {
        let id = new_id();
        let ts = now();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO conversations (id, title, character_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, title, character_id, ts, ts],
        )
        .map_err(|e| e.to_string())?;
        Ok(Conversation {
            id,
            title,
            character_id,
            created_at: ts.clone(),
            updated_at: ts,
        })
    }

    pub fn update_conversation(
        &self,
        id: &str,
        patch: ConversationPatch,
    ) -> Result<Conversation, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut conv = conn
            .query_row(
                "SELECT id, title, character_id, created_at, updated_at FROM conversations WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Conversation {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        character_id: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        if let Some(title) = patch.title {
            conv.title = title;
        }
        if let Some(character_id) = patch.character_id {
            conv.character_id = Some(character_id);
        }
        conv.updated_at = now();

        conn.execute(
            "UPDATE conversations SET title = ?1, character_id = ?2, updated_at = ?3 WHERE id = ?4",
            params![conv.title, conv.character_id, conv.updated_at, conv.id],
        )
        .map_err(|e| e.to_string())?;
        Ok(conv)
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn touch_conversation(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Messages ───────────────────────────────────────────────

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<Message>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, conversation_id, role, content, created_at
                 FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![conversation_id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn add_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
    ) -> Result<Message, String> {
        let id = new_id();
        let ts = now();
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, conversation_id, role, content, ts],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
                params![ts, conversation_id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(Message {
            id,
            conversation_id: conversation_id.into(),
            role: role.into(),
            content: content.into(),
            created_at: ts,
        })
    }

    pub fn update_message_content(&self, id: &str, content: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE messages SET content = ?1 WHERE id = ?2",
            params![content, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Characters ─────────────────────────────────────────────

    pub fn list_characters(&self) -> Result<Vec<Character>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, system_prompt, temperature, created_at, updated_at
                 FROM characters ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Character {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    system_prompt: row.get(3)?,
                    temperature: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn create_character(&self, input: CreateCharacterInput) -> Result<Character, String> {
        let id = new_id();
        let ts = now();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO characters (id, name, description, system_prompt, temperature, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                input.name,
                input.description,
                input.system_prompt,
                input.temperature,
                ts
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(Character {
            id,
            name: input.name,
            description: input.description,
            system_prompt: input.system_prompt,
            temperature: input.temperature,
            created_at: ts,
            updated_at: None,
        })
    }

    pub fn update_character(&self, input: UpdateCharacterInput) -> Result<Character, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut c = conn
            .query_row(
                "SELECT id, name, description, system_prompt, temperature, created_at, updated_at
                 FROM characters WHERE id = ?1",
                params![input.id],
                |row| {
                    Ok(Character {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        system_prompt: row.get(3)?,
                        temperature: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        if let Some(v) = input.name {
            c.name = v;
        }
        if let Some(v) = input.description {
            c.description = v;
        }
        if let Some(v) = input.system_prompt {
            c.system_prompt = v;
        }
        if let Some(v) = input.temperature {
            c.temperature = v;
        }
        c.updated_at = Some(now());

        conn.execute(
            "UPDATE characters SET name = ?1, description = ?2, system_prompt = ?3,
             temperature = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                c.name,
                c.description,
                c.system_prompt,
                c.temperature,
                c.updated_at,
                c.id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(c)
    }

    pub fn delete_character(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM characters WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Settings ───────────────────────────────────────────────

    pub fn get_settings(&self) -> Result<AppSettings, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        match raw {
            Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_settings(&self, patch: serde_json::Value) -> Result<AppSettings, String> {
        let mut current = serde_json::to_value(self.get_settings()?).map_err(|e| e.to_string())?;
        if let (Some(obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
            for (k, v) in patch_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
        let settings: AppSettings =
            serde_json::from_value(current).map_err(|e| e.to_string())?;
        self.save_settings(&settings)?;
        Ok(settings)
    }

    // ── Memories (future-ready stubs) ──────────────────────────

    pub fn list_memories(&self) -> Result<Vec<Memory>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, content, source_message_id, importance, created_at, last_accessed_at
                 FROM memories ORDER BY importance DESC, created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Memory {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    source_message_id: row.get(2)?,
                    importance: row.get(3)?,
                    created_at: row.get(4)?,
                    last_accessed_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}
