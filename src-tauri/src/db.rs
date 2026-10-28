use crate::models::*;
use rusqlite::{named_params, params, Connection, OptionalExtension};
use std::collections::HashSet;
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

/// Seed characters live in one JSON file shared with the TypeScript localStorage
/// branch, so the two seeding paths cannot drift.
const DEFAULT_CHARACTERS_JSON: &str = include_str!("../../src/data/default_characters.json");

/// Columns added to `characters` after the original schema shipped.
const CHARACTER_COLUMNS: &[(&str, &str)] = &[
    ("pronouns", "TEXT NOT NULL DEFAULT ''"),
    ("backstory", "TEXT NOT NULL DEFAULT ''"),
    ("personality_traits", "TEXT NOT NULL DEFAULT '[]'"),
    ("strengths", "TEXT NOT NULL DEFAULT ''"),
    ("weaknesses", "TEXT NOT NULL DEFAULT ''"),
    ("quirks", "TEXT NOT NULL DEFAULT ''"),
    ("core_values", "TEXT NOT NULL DEFAULT ''"),
    ("interests", "TEXT NOT NULL DEFAULT '[]'"),
    ("speaking_style", "TEXT NOT NULL DEFAULT ''"),
    ("response_length", "TEXT NOT NULL DEFAULT 'medium'"),
    ("emoji_usage", "TEXT NOT NULL DEFAULT 'rare'"),
    ("relationship_to_user", "TEXT NOT NULL DEFAULT ''"),
    ("user_alias", "TEXT NOT NULL DEFAULT ''"),
    ("scenario", "TEXT NOT NULL DEFAULT ''"),
    ("greeting", "TEXT NOT NULL DEFAULT ''"),
    ("example_dialogue", "TEXT NOT NULL DEFAULT '[]'"),
    ("boundaries", "TEXT NOT NULL DEFAULT ''"),
    ("memory_enabled", "INTEGER NOT NULL DEFAULT 1"),
    ("key_memories", "TEXT NOT NULL DEFAULT ''"),
    ("appearance_prompt", "TEXT NOT NULL DEFAULT ''"),
    ("appearance_negative_prompt", "TEXT NOT NULL DEFAULT ''"),
    ("appearance_seed", "INTEGER"),
    ("avatar_path", "TEXT"),
    ("avatar_variant", "INTEGER NOT NULL DEFAULT 0"),
    ("can_send_images", "INTEGER NOT NULL DEFAULT 1"),
    ("selfie_style_prompt", "TEXT NOT NULL DEFAULT ''"),
    ("top_p", "REAL"),
    ("max_tokens", "INTEGER"),
    ("prompt_override_enabled", "INTEGER NOT NULL DEFAULT 0"),
    ("narration_style", "TEXT NOT NULL DEFAULT 'story'"),
];

const CHARACTER_SELECT: &str = "id, name, description, system_prompt, temperature, created_at, \
     updated_at, pronouns, backstory, personality_traits, strengths, weaknesses, quirks, \
     core_values, interests, speaking_style, response_length, emoji_usage, \
     relationship_to_user, user_alias, scenario, greeting, example_dialogue, boundaries, \
     memory_enabled, key_memories, appearance_prompt, appearance_negative_prompt, \
     appearance_seed, avatar_path, avatar_variant, can_send_images, selfie_style_prompt, \
     top_p, max_tokens, prompt_override_enabled, narration_style";

fn existing_columns(conn: &Connection, table: &str) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Adds a column when it is absent. Idempotent, and decided by `PRAGMA table_info`
/// rather than by matching the "duplicate column name" error string.
fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<(), String> {
    if existing_columns(conn, table)?.contains(column) {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"),
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Tolerant JSON decode: a malformed value yields an empty list rather than failing
/// the whole `list_characters` call.
fn json_list<T: serde::de::DeserializeOwned>(raw: &str) -> Vec<T> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn json_text<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".into())
}

fn map_character_row(row: &rusqlite::Row) -> rusqlite::Result<Character> {
    let traits: String = row.get(9)?;
    let interests: String = row.get(14)?;
    let examples: String = row.get(22)?;
    Ok(Character {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        system_prompt: row.get(3)?,
        temperature: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        pronouns: row.get(7)?,
        backstory: row.get(8)?,
        personality_traits: json_list(&traits),
        strengths: row.get(10)?,
        weaknesses: row.get(11)?,
        quirks: row.get(12)?,
        core_values: row.get(13)?,
        interests: json_list(&interests),
        speaking_style: row.get(15)?,
        response_length: row.get(16)?,
        emoji_usage: row.get(17)?,
        relationship_to_user: row.get(18)?,
        user_alias: row.get(19)?,
        scenario: row.get(20)?,
        greeting: row.get(21)?,
        example_dialogue: json_list(&examples),
        boundaries: row.get(23)?,
        memory_enabled: row.get(24)?,
        key_memories: row.get(25)?,
        appearance_prompt: row.get(26)?,
        appearance_negative_prompt: row.get(27)?,
        appearance_seed: row.get(28)?,
        avatar_path: row.get(29)?,
        avatar_variant: row.get(30)?,
        can_send_images: row.get(31)?,
        selfie_style_prompt: row.get(32)?,
        top_p: row.get(33)?,
        max_tokens: row.get(34)?,
        prompt_override_enabled: row.get(35)?,
        narration_style: row.get(36)?,
    })
}

fn map_memory_row(row: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        character_id: row.get(1)?,
        conversation_id: row.get(2)?,
        kind: row.get(3)?,
        content: row.get(4)?,
        keywords: row.get(5)?,
        importance: row.get(6)?,
        pinned: row.get(7)?,
        source_message_id: row.get(8)?,
        hits: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        last_accessed_at: row.get(12)?,
    })
}

const IMAGE_SELECT: &str = "id, conversation_id, message_id, original_prompt, \
     enhanced_prompt, image_path, width, height, seed, sampler, steps, cfg, created_at, \
     generation_time_ms, caption, kind";

fn map_image_row(row: &rusqlite::Row) -> rusqlite::Result<GeneratedImage> {
    Ok(GeneratedImage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        message_id: row.get(2)?,
        original_prompt: row.get(3)?,
        enhanced_prompt: row.get(4)?,
        image_path: row.get(5)?,
        width: row.get(6)?,
        height: row.get(7)?,
        seed: row.get(8)?,
        sampler: row.get(9)?,
        steps: row.get(10)?,
        cfg: row.get(11)?,
        created_at: row.get(12)?,
        generation_time_ms: row.get(13)?,
        caption: row.get(14)?,
        kind: row.get(15)?,
    })
}

const MEMORY_SELECT: &str = "id, character_id, conversation_id, kind, content, keywords, \
     importance, pinned, source_message_id, hits, created_at, updated_at, last_accessed_at";

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

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS generated_images (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                original_prompt TEXT NOT NULL,
                enhanced_prompt TEXT NOT NULL,
                image_path TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                seed INTEGER NOT NULL,
                sampler TEXT NOT NULL,
                steps INTEGER NOT NULL,
                cfg REAL NOT NULL,
                created_at TEXT NOT NULL,
                generation_time_ms INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_generated_images_conversation
                ON generated_images(conversation_id);

            CREATE INDEX IF NOT EXISTS idx_generated_images_message
                ON generated_images(message_id);

            -- Who is in a group conversation. The conversation's own character_id
            -- stays as the primary, so solo chats and the sidebar are unaffected.
            CREATE TABLE IF NOT EXISTS conversation_participants (
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                added_at TEXT NOT NULL,
                PRIMARY KEY (conversation_id, character_id)
            );

            CREATE INDEX IF NOT EXISTS idx_participants_conversation
                ON conversation_participants(conversation_id, position);

            -- Rolling background summary, one row per conversation. Kept out of the
            -- conversations table so the many `UPDATE conversations SET ...` paths
            -- can never clobber work written by a background summarization run.
            CREATE TABLE IF NOT EXISTS conversation_summaries (
                conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
                summary TEXT NOT NULL DEFAULT '',
                summarized_up_to_message_id TEXT,
                summarized_up_to_created_at TEXT,
                message_count INTEGER NOT NULL DEFAULT 0,
                token_estimate INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| e.to_string())?;

        // Additive, self-healing DDL. Safe on every boot, and correct even against a
        // database left behind by a half-finished build.
        for (column, decl) in CHARACTER_COLUMNS {
            ensure_column(&conn, "characters", column, decl)?;
        }
        // Which character said it. Null for user messages and for replies written
        // before group chats existed, where the conversation's own character answers.
        ensure_column(&conn, "messages", "character_id", "TEXT")?;
        // The user's own steer for a scene. Safe on `conversations`: `update_conversation`
        // reads the row before writing it back, and `touch_conversation` only sets
        // `updated_at`, so neither can drop it.
        ensure_column(
            &conn,
            "conversations",
            "scene_note",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        // Where the scene physically is. Written by its own background pass, so it lives
        // beside the summary rather than on `conversations`.
        ensure_column(
            &conn,
            "conversation_summaries",
            "scene",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(&conn, "generated_images", "caption", "TEXT NOT NULL DEFAULT ''")?;
        ensure_column(
            &conn,
            "generated_images",
            "kind",
            "TEXT NOT NULL DEFAULT 'user_request'",
        )?;

        // One-shot data backfills. `user_version` guards data only -- never DDL.
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;

        if version < 2 {
            // The `memories` table shipped as an unused stub with no writer anywhere,
            // so it is provably empty and can be recreated with the real schema.
            conn.execute_batch(
                r#"
                DROP TABLE IF EXISTS memories;
                CREATE TABLE memories (
                    id TEXT PRIMARY KEY,
                    character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
                    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
                    kind TEXT NOT NULL DEFAULT 'fact',
                    content TEXT NOT NULL,
                    keywords TEXT NOT NULL DEFAULT '',
                    importance REAL NOT NULL DEFAULT 0.5,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    source_message_id TEXT,
                    hits INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_accessed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_memories_character
                    ON memories(character_id, pinned DESC, importance DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_dedup
                    ON memories(character_id, kind, content);
                "#,
            )
            .map_err(|e| e.to_string())?;

            // Characters authored before the rich schema: their system_prompt IS the
            // persona, so keep using it verbatim.
            conn.execute(
                "UPDATE characters SET prompt_override_enabled = 1
                 WHERE TRIM(system_prompt) <> ''
                   AND TRIM(backstory) = ''
                   AND personality_traits = '[]'",
                [],
            )
            .map_err(|e| e.to_string())?;

            conn.execute_batch("PRAGMA user_version = 2;")
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    fn seed_defaults(&self) -> Result<(), String> {
        let count: i64 = {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row("SELECT COUNT(*) FROM characters", [], |r| r.get(0))
                .map_err(|e| e.to_string())?
        };

        if count == 0 {
            let defaults: Vec<CreateCharacterInput> =
                serde_json::from_str(DEFAULT_CHARACTERS_JSON).map_err(|e| e.to_string())?;

            let mut first_id: Option<String> = None;
            for input in defaults {
                let c = self.create_character(input)?;
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
                "SELECT id, title, character_id, created_at, updated_at, scene_note
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
                    scene_note: row.get(5)?,
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
            scene_note: String::new(),
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
                "SELECT id, title, character_id, created_at, updated_at, scene_note
                 FROM conversations WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Conversation {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        character_id: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                        scene_note: row.get(5)?,
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
        if let Some(scene_note) = patch.scene_note {
            conv.scene_note = scene_note;
        }
        conv.updated_at = now();

        conn.execute(
            "UPDATE conversations
                SET title = ?1, character_id = ?2, updated_at = ?3, scene_note = ?4
              WHERE id = ?5",
            params![
                conv.title,
                conv.character_id,
                conv.updated_at,
                conv.scene_note,
                conv.id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(conv)
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), String> {
        // Collect image paths before cascade delete so files can be removed from disk
        let paths = self.list_image_paths_for_conversation(id)?;
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
        for path in paths {
            let _ = std::fs::remove_file(&path);
        }
        Ok(())
    }

    fn list_image_paths_for_conversation(&self, conversation_id: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT image_path FROM generated_images WHERE conversation_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![conversation_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
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
                "SELECT id, conversation_id, role, content, created_at, character_id
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
                    character_id: row.get(5)?,
                    image: None,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut messages = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);

        // Attach generated image metadata for image-role messages
        let mut img_stmt = conn
            .prepare(&format!(
                "SELECT {IMAGE_SELECT} FROM generated_images WHERE conversation_id = ?1"
            ))
            .map_err(|e| e.to_string())?;
        let img_rows = img_stmt
            .query_map(params![conversation_id], map_image_row)
            .map_err(|e| e.to_string())?;

        let images: Vec<GeneratedImage> = img_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for msg in &mut messages {
            msg.image = images
                .iter()
                .find(|img| img.message_id == msg.id)
                .cloned();
        }

        Ok(messages)
    }

    pub fn add_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        character_id: Option<String>,
    ) -> Result<Message, String> {
        let id = new_id();
        let ts = now();
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at, character_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, conversation_id, role, content, ts, character_id],
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
            character_id,
            image: None,
        })
    }

    // ── Group participants ─────────────────────────────────────

    pub fn list_participants(&self, conversation_id: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT character_id FROM conversation_participants
                 WHERE conversation_id = ?1 ORDER BY position ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![conversation_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Replaces the cast. The first entry also becomes the conversation's primary
    /// character, which is what the sidebar and solo-chat paths still read.
    pub fn set_participants(
        &self,
        conversation_id: &str,
        character_ids: Vec<String>,
    ) -> Result<(), String> {
        let ts = now();
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM conversation_participants WHERE conversation_id = ?1",
                params![conversation_id],
            )
            .map_err(|e| e.to_string())?;

            for (position, character_id) in character_ids.iter().enumerate() {
                conn.execute(
                    "INSERT OR IGNORE INTO conversation_participants
                     (conversation_id, character_id, position, added_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![conversation_id, character_id, position as i64, ts],
                )
                .map_err(|e| e.to_string())?;
            }

            if let Some(primary) = character_ids.first() {
                conn.execute(
                    "UPDATE conversations SET character_id = ?1 WHERE id = ?2",
                    params![primary, conversation_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn delete_message(&self, id: &str) -> Result<Option<String>, String> {
        // Return image path if this was an image message so caller can delete the file
        let image_path: Option<String> = {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT image_path FROM generated_images WHERE message_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM messages WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(image_path)
    }

    // ── Generated Images ───────────────────────────────────────

    pub fn create_generated_image(
        &self,
        input: CreateGeneratedImageInput,
    ) -> Result<GeneratedImage, String> {
        let id = new_id();
        let ts = now();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO generated_images (
                id, conversation_id, message_id, original_prompt, enhanced_prompt,
                image_path, width, height, seed, sampler, steps, cfg, created_at,
                generation_time_ms, caption, kind
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                id,
                input.conversation_id,
                input.message_id,
                input.original_prompt,
                input.enhanced_prompt,
                input.image_path,
                input.width,
                input.height,
                input.seed,
                input.sampler,
                input.steps,
                input.cfg,
                ts,
                input.generation_time_ms,
                input.caption.clone(),
                input.kind.clone()
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(GeneratedImage {
            id,
            conversation_id: input.conversation_id,
            message_id: input.message_id,
            original_prompt: input.original_prompt,
            enhanced_prompt: input.enhanced_prompt,
            image_path: input.image_path,
            width: input.width,
            height: input.height,
            seed: input.seed,
            sampler: input.sampler,
            steps: input.steps,
            cfg: input.cfg,
            created_at: ts,
            generation_time_ms: input.generation_time_ms,
            caption: input.caption,
            kind: input.kind,
        })
    }

    pub fn get_generated_image(&self, id: &str) -> Result<Option<GeneratedImage>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("SELECT {IMAGE_SELECT} FROM generated_images WHERE id = ?1"),
            params![id],
            map_image_row,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn search_conversations(&self, query: &str) -> Result<Vec<Conversation>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let pattern = format!("%{}%", query);
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT c.id, c.title, c.character_id, c.created_at, c.updated_at,
                        c.scene_note
                 FROM conversations c
                 LEFT JOIN messages m ON m.conversation_id = c.id
                 LEFT JOIN generated_images g ON g.conversation_id = c.id
                 WHERE c.title LIKE ?1
                    OR m.content LIKE ?1
                    OR g.original_prompt LIKE ?1
                    OR g.enhanced_prompt LIKE ?1
                 ORDER BY c.updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pattern], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    character_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    scene_note: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
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

    // ── Characters ─────────────────────────────

    pub fn list_characters(&self) -> Result<Vec<Character>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {CHARACTER_SELECT} FROM characters ORDER BY created_at ASC"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_character_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_character(&self, id: &str) -> Result<Option<Character>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("SELECT {CHARACTER_SELECT} FROM characters WHERE id = ?1"),
            params![id],
            map_character_row,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn create_character(&self, input: CreateCharacterInput) -> Result<Character, String> {
        let id = new_id();
        let ts = now();
        let character = Character {
            id: id.clone(),
            name: input.name,
            description: input.description,
            system_prompt: input.system_prompt,
            temperature: input.temperature,
            created_at: ts,
            updated_at: None,
            pronouns: input.pronouns,
            backstory: input.backstory,
            personality_traits: input.personality_traits,
            strengths: input.strengths,
            weaknesses: input.weaknesses,
            quirks: input.quirks,
            core_values: input.core_values,
            interests: input.interests,
            speaking_style: input.speaking_style,
            response_length: input.response_length,
            emoji_usage: input.emoji_usage,
            relationship_to_user: input.relationship_to_user,
            user_alias: input.user_alias,
            scenario: input.scenario,
            greeting: input.greeting,
            example_dialogue: input.example_dialogue,
            boundaries: input.boundaries,
            memory_enabled: input.memory_enabled,
            key_memories: input.key_memories,
            appearance_prompt: input.appearance_prompt,
            appearance_negative_prompt: input.appearance_negative_prompt,
            appearance_seed: input.appearance_seed,
            avatar_path: input.avatar_path,
            avatar_variant: input.avatar_variant,
            can_send_images: input.can_send_images,
            selfie_style_prompt: input.selfie_style_prompt,
            top_p: input.top_p,
            max_tokens: input.max_tokens,
            prompt_override_enabled: input.prompt_override_enabled,
            narration_style: input.narration_style,
        };

        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            Self::write_character(&conn, &character, true)?;
        }
        Ok(character)
    }

    pub fn update_character(&self, input: UpdateCharacterInput) -> Result<Character, String> {
        let mut c = self
            .get_character(&input.id)?
            .ok_or_else(|| format!("No character with id {}", input.id))?;

        if let Some(v) = input.name { c.name = v }
        if let Some(v) = input.description { c.description = v }
        if let Some(v) = input.system_prompt { c.system_prompt = v }
        if let Some(v) = input.temperature { c.temperature = v }
        if let Some(v) = input.pronouns { c.pronouns = v }
        if let Some(v) = input.backstory { c.backstory = v }
        if let Some(v) = input.personality_traits { c.personality_traits = v }
        if let Some(v) = input.strengths { c.strengths = v }
        if let Some(v) = input.weaknesses { c.weaknesses = v }
        if let Some(v) = input.quirks { c.quirks = v }
        if let Some(v) = input.core_values { c.core_values = v }
        if let Some(v) = input.interests { c.interests = v }
        if let Some(v) = input.speaking_style { c.speaking_style = v }
        if let Some(v) = input.response_length { c.response_length = v }
        if let Some(v) = input.emoji_usage { c.emoji_usage = v }
        if let Some(v) = input.relationship_to_user { c.relationship_to_user = v }
        if let Some(v) = input.user_alias { c.user_alias = v }
        if let Some(v) = input.scenario { c.scenario = v }
        if let Some(v) = input.greeting { c.greeting = v }
        if let Some(v) = input.example_dialogue { c.example_dialogue = v }
        if let Some(v) = input.boundaries { c.boundaries = v }
        if let Some(v) = input.memory_enabled { c.memory_enabled = v }
        if let Some(v) = input.key_memories { c.key_memories = v }
        if let Some(v) = input.appearance_prompt { c.appearance_prompt = v }
        if let Some(v) = input.appearance_negative_prompt { c.appearance_negative_prompt = v }
        if input.appearance_seed.is_some() { c.appearance_seed = input.appearance_seed }
        if input.avatar_path.is_some() { c.avatar_path = input.avatar_path }
        if let Some(v) = input.avatar_variant { c.avatar_variant = v }
        if let Some(v) = input.can_send_images { c.can_send_images = v }
        if let Some(v) = input.selfie_style_prompt { c.selfie_style_prompt = v }
        if input.top_p.is_some() { c.top_p = input.top_p }
        if input.max_tokens.is_some() { c.max_tokens = input.max_tokens }
        if let Some(v) = input.prompt_override_enabled { c.prompt_override_enabled = v }
        if let Some(v) = input.narration_style { c.narration_style = v }
        c.updated_at = Some(now());

        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            Self::write_character(&conn, &c, false)?;
        }
        Ok(c)
    }

    /// Named parameters throughout: with 36 columns, positional `?1..?36` is a
    /// silent-corruption hazard.
    fn write_character(conn: &Connection, c: &Character, insert: bool) -> Result<(), String> {
        let sql = if insert {
            "INSERT INTO characters (
                id, name, description, system_prompt, temperature, created_at, updated_at,
                pronouns, backstory, personality_traits, strengths, weaknesses, quirks,
                core_values, interests, speaking_style, response_length, emoji_usage,
                relationship_to_user, user_alias, scenario, greeting, example_dialogue,
                boundaries, memory_enabled, key_memories, appearance_prompt,
                appearance_negative_prompt, appearance_seed, avatar_path, avatar_variant,
                can_send_images, selfie_style_prompt, top_p, max_tokens, prompt_override_enabled,
                narration_style
             ) VALUES (
                :id, :name, :description, :system_prompt, :temperature, :created_at, :updated_at,
                :pronouns, :backstory, :personality_traits, :strengths, :weaknesses, :quirks,
                :core_values, :interests, :speaking_style, :response_length, :emoji_usage,
                :relationship_to_user, :user_alias, :scenario, :greeting, :example_dialogue,
                :boundaries, :memory_enabled, :key_memories, :appearance_prompt,
                :appearance_negative_prompt, :appearance_seed, :avatar_path, :avatar_variant,
                :can_send_images, :selfie_style_prompt, :top_p, :max_tokens, :prompt_override_enabled,
                :narration_style
             )"
        } else {
            "UPDATE characters SET
                name = :name, description = :description, system_prompt = :system_prompt,
                temperature = :temperature, created_at = :created_at, updated_at = :updated_at,
                pronouns = :pronouns, backstory = :backstory,
                personality_traits = :personality_traits, strengths = :strengths,
                weaknesses = :weaknesses, quirks = :quirks, core_values = :core_values,
                interests = :interests, speaking_style = :speaking_style,
                response_length = :response_length, emoji_usage = :emoji_usage,
                relationship_to_user = :relationship_to_user, user_alias = :user_alias,
                scenario = :scenario, greeting = :greeting, example_dialogue = :example_dialogue,
                boundaries = :boundaries, memory_enabled = :memory_enabled,
                key_memories = :key_memories, appearance_prompt = :appearance_prompt,
                appearance_negative_prompt = :appearance_negative_prompt,
                appearance_seed = :appearance_seed, avatar_path = :avatar_path,
                avatar_variant = :avatar_variant, can_send_images = :can_send_images,
                selfie_style_prompt = :selfie_style_prompt, top_p = :top_p,
                max_tokens = :max_tokens, prompt_override_enabled = :prompt_override_enabled,
                narration_style = :narration_style
             WHERE id = :id"
        };

        conn.execute(
            sql,
            named_params! {
                ":id": c.id,
                ":name": c.name,
                ":description": c.description,
                ":system_prompt": c.system_prompt,
                ":temperature": c.temperature,
                ":created_at": c.created_at,
                ":updated_at": c.updated_at,
                ":pronouns": c.pronouns,
                ":backstory": c.backstory,
                ":personality_traits": json_text(&c.personality_traits),
                ":strengths": c.strengths,
                ":weaknesses": c.weaknesses,
                ":quirks": c.quirks,
                ":core_values": c.core_values,
                ":interests": json_text(&c.interests),
                ":speaking_style": c.speaking_style,
                ":response_length": c.response_length,
                ":emoji_usage": c.emoji_usage,
                ":relationship_to_user": c.relationship_to_user,
                ":user_alias": c.user_alias,
                ":scenario": c.scenario,
                ":greeting": c.greeting,
                ":example_dialogue": json_text(&c.example_dialogue),
                ":boundaries": c.boundaries,
                ":memory_enabled": c.memory_enabled,
                ":key_memories": c.key_memories,
                ":appearance_prompt": c.appearance_prompt,
                ":appearance_negative_prompt": c.appearance_negative_prompt,
                ":appearance_seed": c.appearance_seed,
                ":avatar_path": c.avatar_path,
                ":avatar_variant": c.avatar_variant,
                ":can_send_images": c.can_send_images,
                ":selfie_style_prompt": c.selfie_style_prompt,
                ":top_p": c.top_p,
                ":max_tokens": c.max_tokens,
                ":prompt_override_enabled": c.prompt_override_enabled,
                ":narration_style": c.narration_style,
            },
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Returns the deleted character's avatar path so the caller can remove the file.
    /// Also clears `active_character_id` when it pointed at this row, which otherwise
    /// dangles and silently falls back to the first character.
    pub fn delete_character(&self, id: &str) -> Result<Option<String>, String> {
        let avatar_path = self.get_character(id)?.and_then(|c| c.avatar_path);

        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM characters WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }

        let mut settings = self.get_settings()?;
        if settings.active_character_id.as_deref() == Some(id) {
            settings.active_character_id = self.list_characters()?.first().map(|c| c.id.clone());
            self.save_settings(&settings)?;
        }

        Ok(avatar_path)
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

    // ── Memories ──────────────────────────────

    pub fn list_memories(&self, character_id: Option<String>) -> Result<Vec<Memory>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (sql, bound): (String, Vec<String>) = match &character_id {
            Some(id) => (
                format!(
                    "SELECT {MEMORY_SELECT} FROM memories WHERE character_id = ?1
                     ORDER BY pinned DESC, importance DESC, updated_at DESC"
                ),
                vec![id.clone()],
            ),
            None => (
                format!(
                    "SELECT {MEMORY_SELECT} FROM memories
                     ORDER BY pinned DESC, importance DESC, updated_at DESC"
                ),
                vec![],
            ),
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(bound.iter()), map_memory_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn create_memory(&self, input: CreateMemoryInput) -> Result<Memory, String> {
        let id = new_id();
        let ts = now();
        let memory = Memory {
            id,
            character_id: input.character_id,
            conversation_id: input.conversation_id,
            kind: input.kind,
            content: input.content,
            keywords: input.keywords,
            importance: input.importance,
            pinned: input.pinned,
            source_message_id: input.source_message_id,
            hits: 0,
            created_at: ts.clone(),
            updated_at: ts,
            last_accessed_at: None,
        };

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // The dedup index makes a same-content insert a no-op rather than an error;
        // the caller merges deliberately via update_memory.
        conn.execute(
            "INSERT OR IGNORE INTO memories (
                id, character_id, conversation_id, kind, content, keywords, importance,
                pinned, source_message_id, hits, created_at, updated_at, last_accessed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                memory.id,
                memory.character_id,
                memory.conversation_id,
                memory.kind,
                memory.content,
                memory.keywords,
                memory.importance,
                memory.pinned,
                memory.source_message_id,
                memory.hits,
                memory.created_at,
                memory.updated_at,
                memory.last_accessed_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(memory)
    }

    pub fn update_memory(&self, input: UpdateMemoryInput) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let ts = now();
        conn.execute(
            "UPDATE memories SET
                content = COALESCE(:content, content),
                keywords = COALESCE(:keywords, keywords),
                kind = COALESCE(:kind, kind),
                importance = COALESCE(:importance, importance),
                pinned = COALESCE(:pinned, pinned),
                hits = COALESCE(:hits, hits),
                last_accessed_at = CASE WHEN :touch THEN :ts ELSE last_accessed_at END,
                updated_at = :ts
             WHERE id = :id",
            named_params! {
                ":id": input.id,
                ":content": input.content,
                ":keywords": input.keywords,
                ":kind": input.kind,
                ":importance": input.importance,
                ":pinned": input.pinned,
                ":hits": input.hits,
                ":touch": input.touch_access.unwrap_or(false),
                ":ts": ts,
            },
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_memory(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_memories_for_character(&self, character_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM memories WHERE character_id = ?1",
            params![character_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Conversation summaries ──────────────────────

    pub fn get_conversation_summary(
        &self,
        conversation_id: &str,
    ) -> Result<Option<ConversationSummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT conversation_id, summary, summarized_up_to_message_id,
                    summarized_up_to_created_at, message_count, token_estimate, version,
                    updated_at, scene
             FROM conversation_summaries WHERE conversation_id = ?1",
            params![conversation_id],
            |row| {
                Ok(ConversationSummary {
                    conversation_id: row.get(0)?,
                    summary: row.get(1)?,
                    summarized_up_to_message_id: row.get(2)?,
                    summarized_up_to_created_at: row.get(3)?,
                    message_count: row.get(4)?,
                    token_estimate: row.get(5)?,
                    version: row.get(6)?,
                    updated_at: row.get(7)?,
                    scene: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Optimistic write. When `expected_version` is given and no longer matches, the
    /// write is skipped and `None` is returned — a background run that raced a newer
    /// one simply loses, which is never a correctness problem.
    pub fn upsert_conversation_summary(
        &self,
        input: UpsertSummaryInput,
    ) -> Result<Option<ConversationSummary>, String> {
        if let Some(expected) = input.expected_version {
            let current = self.get_conversation_summary(&input.conversation_id)?;
            let actual = current.as_ref().map(|c| c.version).unwrap_or(0);
            if actual != expected {
                return Ok(None);
            }
        }

        let ts = now();
        let next_version = input.expected_version.unwrap_or(0) + 1;
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO conversation_summaries (
                    conversation_id, summary, summarized_up_to_message_id,
                    summarized_up_to_created_at, message_count, token_estimate, version, updated_at
                 ) VALUES (:cid, :summary, :msg_id, :msg_at, :count, :tokens, :version, :ts)
                 ON CONFLICT(conversation_id) DO UPDATE SET
                    summary = excluded.summary,
                    summarized_up_to_message_id = excluded.summarized_up_to_message_id,
                    summarized_up_to_created_at = excluded.summarized_up_to_created_at,
                    message_count = excluded.message_count,
                    token_estimate = excluded.token_estimate,
                    version = conversation_summaries.version + 1,
                    updated_at = excluded.updated_at",
                named_params! {
                    ":cid": input.conversation_id,
                    ":summary": input.summary,
                    ":msg_id": input.summarized_up_to_message_id,
                    ":msg_at": input.summarized_up_to_created_at,
                    ":count": input.message_count,
                    ":tokens": input.token_estimate,
                    ":version": next_version,
                    ":ts": ts,
                },
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_conversation_summary(&input.conversation_id)
    }

    /// Writes only the scene. Deliberately leaves `version` alone — `summarizeConversation`
    /// passes an `expected_version` it read before running the model, and bumping it here
    /// would make every background summary write lose its race from then on.
    pub fn set_conversation_scene(
        &self,
        conversation_id: &str,
        scene: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO conversation_summaries (conversation_id, scene, version, updated_at)
             VALUES (?1, ?2, 0, ?3)
             ON CONFLICT(conversation_id) DO UPDATE SET scene = excluded.scene",
            params![conversation_id, scene, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_conversation_summary(&self, conversation_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM conversation_summaries WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn count_images_of_kind(&self, conversation_id: &str, kind: &str) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM generated_images WHERE conversation_id = ?1 AND kind = ?2",
            params![conversation_id, kind],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The schema exactly as it shipped before characters grew a persona.
    const LEGACY_SCHEMA: &str = r#"
        CREATE TABLE characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            system_prompt TEXT NOT NULL,
            temperature REAL NOT NULL DEFAULT 0.7,
            created_at TEXT NOT NULL,
            updated_at TEXT
        );
        CREATE TABLE conversations (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, character_id TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE messages (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
            content TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE memories (
            id TEXT PRIMARY KEY, content TEXT NOT NULL, source_message_id TEXT,
            importance REAL NOT NULL DEFAULT 0.5, created_at TEXT NOT NULL,
            last_accessed_at TEXT
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE generated_images (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL,
            original_prompt TEXT NOT NULL, enhanced_prompt TEXT NOT NULL,
            image_path TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
            seed INTEGER NOT NULL, sampler TEXT NOT NULL, steps INTEGER NOT NULL,
            cfg REAL NOT NULL, created_at TEXT NOT NULL,
            generation_time_ms INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO characters (id, name, description, system_prompt, temperature, created_at)
        VALUES ('legacy-1', 'Coding Expert', 'Senior engineer', 'You are an expert software engineer.', 0.4, '2024-01-01T00:00:00Z');
    "#;

    fn temp_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("mylocalai-test-{tag}-{}.db", Uuid::new_v4()))
    }

    #[test]
    fn migrates_a_legacy_database_without_losing_characters() {
        let path = temp_path("legacy");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(LEGACY_SCHEMA).unwrap();
        }

        let db = Database::open(path.clone()).unwrap();

        let characters = db.list_characters().unwrap();
        assert_eq!(characters.len(), 1, "the existing character must survive");
        let c = &characters[0];
        assert_eq!(c.name, "Coding Expert");
        assert_eq!(c.system_prompt, "You are an expert software engineer.");
        // A character authored before the persona fields keeps using its own prompt.
        assert!(c.prompt_override_enabled);
        // New fields arrive with usable defaults rather than nulls.
        assert_eq!(c.response_length, "medium");
        assert!(c.personality_traits.is_empty());
        assert_eq!(c.appearance_seed, None);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migration_is_idempotent_across_restarts() {
        let path = temp_path("idempotent");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(LEGACY_SCHEMA).unwrap();
        }

        let first = Database::open(path.clone()).unwrap();
        let before = first.list_characters().unwrap().len();
        drop(first);

        // Second launch must not re-run the ALTERs or re-seed.
        let second = Database::open(path.clone()).unwrap();
        assert_eq!(second.list_characters().unwrap().len(), before);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn seeds_characters_into_an_empty_database() {
        let path = temp_path("seed");
        let db = Database::open(path.clone()).unwrap();

        let characters = db.list_characters().unwrap();
        assert!(!characters.is_empty(), "a fresh database gets the seed set");
        assert!(
            characters.iter().any(|c| c.prompt_override_enabled),
            "the plain assistants still use their own prompt",
        );
        let rich = characters
            .iter()
            .find(|c| !c.prompt_override_enabled)
            .expect("the seed set includes a full persona");
        assert!(!rich.backstory.is_empty());
        assert!(!rich.appearance_prompt.is_empty());
        assert!(!rich.example_dialogue.is_empty());

        // The active character is set so the first chat has someone to talk to.
        assert!(db.get_settings().unwrap().active_character_id.is_some());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn stores_and_recalls_a_full_persona_round_trip() {
        let path = temp_path("roundtrip");
        let db = Database::open(path.clone()).unwrap();

        let created = db
            .create_character(CreateCharacterInput {
                name: "Test".into(),
                personality_traits: vec!["dry".into(), "stubborn".into()],
                example_dialogue: vec![ExampleExchange {
                    user: "hi".into(),
                    character: "hey.".into(),
                }],
                appearance_seed: Some(1234),
                response_length: "short".into(),
                emoji_usage: "none".into(),
                ..Default::default()
            })
            .unwrap();

        let fetched = db.get_character(&created.id).unwrap().unwrap();
        assert_eq!(fetched.personality_traits, vec!["dry", "stubborn"]);
        assert_eq!(fetched.example_dialogue.len(), 1);
        assert_eq!(fetched.example_dialogue[0].character, "hey.");
        assert_eq!(fetched.appearance_seed, Some(1234));
        assert_eq!(fetched.response_length, "short");

        db.update_character(UpdateCharacterInput {
            id: created.id.clone(),
            avatar_path: Some("/tmp/a-1.png".into()),
            avatar_variant: Some(1),
            ..Default::default()
        })
        .unwrap();

        let updated = db.get_character(&created.id).unwrap().unwrap();
        assert_eq!(updated.avatar_path.as_deref(), Some("/tmp/a-1.png"));
        assert_eq!(updated.avatar_variant, 1);
        // An untouched field must not be clobbered by the partial update.
        assert_eq!(updated.personality_traits, vec!["dry", "stubborn"]);

        let avatar = db.delete_character(&created.id).unwrap();
        assert_eq!(avatar.as_deref(), Some("/tmp/a-1.png"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn participants_drive_the_primary_character_and_survive_reordering() {
        let path = temp_path("participants");
        let db = Database::open(path.clone()).unwrap();
        let characters = db.list_characters().unwrap();
        let a = characters[0].id.clone();
        let b = characters[1].id.clone();

        let conv = db.create_conversation("c".into(), Some(a.clone())).unwrap();
        db.set_participants(&conv.id, vec![a.clone(), b.clone()])
            .unwrap();
        assert_eq!(db.list_participants(&conv.id).unwrap(), vec![a.clone(), b.clone()]);

        // Reordering makes a different character primary; the sidebar reads that.
        db.set_participants(&conv.id, vec![b.clone(), a.clone()])
            .unwrap();
        assert_eq!(db.list_participants(&conv.id).unwrap(), vec![b.clone(), a.clone()]);
        let refreshed = db
            .list_conversations()
            .unwrap()
            .into_iter()
            .find(|c| c.id == conv.id)
            .unwrap();
        assert_eq!(refreshed.character_id.as_deref(), Some(b.as_str()));

        // Dropping back to one leaves exactly one.
        db.set_participants(&conv.id, vec![a.clone()]).unwrap();
        assert_eq!(db.list_participants(&conv.id).unwrap(), vec![a.clone()]);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn messages_remember_which_character_said_them() {
        let path = temp_path("authorship");
        let db = Database::open(path.clone()).unwrap();
        let characters = db.list_characters().unwrap();
        let a = characters[0].id.clone();
        let b = characters[1].id.clone();
        let conv = db.create_conversation("c".into(), Some(a.clone())).unwrap();

        db.add_message(&conv.id, "user", "hi both", None).unwrap();
        db.add_message(&conv.id, "assistant", "hey", Some(a.clone()))
            .unwrap();
        db.add_message(&conv.id, "assistant", "evening", Some(b.clone()))
            .unwrap();

        let messages = db.list_messages(&conv.id).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].character_id, None, "user messages have no author");
        assert_eq!(messages[1].character_id.as_deref(), Some(a.as_str()));
        assert_eq!(messages[2].character_id.as_deref(), Some(b.as_str()));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn deleting_a_character_removes_it_from_conversations() {
        let path = temp_path("cascade");
        let db = Database::open(path.clone()).unwrap();
        let characters = db.list_characters().unwrap();
        let a = characters[0].id.clone();
        let b = characters[1].id.clone();
        let conv = db.create_conversation("c".into(), Some(a.clone())).unwrap();
        db.set_participants(&conv.id, vec![a.clone(), b.clone()])
            .unwrap();

        db.delete_character(&b).unwrap();

        assert_eq!(
            db.list_participants(&conv.id).unwrap(),
            vec![a.clone()],
            "a deleted character leaves the cast",
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn summary_writes_are_rejected_when_they_lose_a_race() {
        let path = temp_path("summary");
        let db = Database::open(path.clone()).unwrap();
        let conv = db.create_conversation("c".into(), None).unwrap();

        let first = db
            .upsert_conversation_summary(UpsertSummaryInput {
                conversation_id: conv.id.clone(),
                summary: "first".into(),
                summarized_up_to_message_id: None,
                summarized_up_to_created_at: None,
                message_count: 2,
                token_estimate: 10,
                expected_version: Some(0),
            })
            .unwrap()
            .expect("first write lands");
        assert_eq!(first.summary, "first");

        // A background run that started before `first` still holds version 0.
        let stale = db
            .upsert_conversation_summary(UpsertSummaryInput {
                conversation_id: conv.id.clone(),
                summary: "stale".into(),
                summarized_up_to_message_id: None,
                summarized_up_to_created_at: None,
                message_count: 2,
                token_estimate: 10,
                expected_version: Some(0),
            })
            .unwrap();
        assert!(stale.is_none(), "a stale write is discarded, not applied");
        assert_eq!(
            db.get_conversation_summary(&conv.id).unwrap().unwrap().summary,
            "first",
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn images_attach_to_any_message_not_just_image_rows() {
        let path = temp_path("attach");
        let db = Database::open(path.clone()).unwrap();
        let conv = db.create_conversation("c".into(), None).unwrap();
        let reply = db
            .add_message(&conv.id, "assistant", "look at this view", None)
            .unwrap();

        db.create_generated_image(CreateGeneratedImageInput {
            conversation_id: conv.id.clone(),
            message_id: reply.id.clone(),
            original_prompt: "balcony at dusk".into(),
            enhanced_prompt: "woman, balcony at dusk".into(),
            image_path: "/tmp/x.png".into(),
            width: 512,
            height: 512,
            seed: 7,
            sampler: "euler_a".into(),
            steps: 20,
            cfg: 7.0,
            generation_time_ms: 1200,
            caption: "balcony at dusk".into(),
            kind: "character_selfie".into(),
        })
        .unwrap();

        let messages = db.list_messages(&conv.id).unwrap();
        let attached = messages
            .iter()
            .find(|m| m.id == reply.id)
            .and_then(|m| m.image.as_ref())
            .expect("a selfie hangs off its assistant message");
        assert_eq!(attached.caption, "balcony at dusk");
        assert_eq!(attached.kind, "character_selfie");
        assert_eq!(
            db.count_images_of_kind(&conv.id, "character_selfie").unwrap(),
            1,
        );

        let _ = std::fs::remove_file(&path);
    }
}
