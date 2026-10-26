import type {
  AppSettings,
  Character,
  CharacterDraft,
  Conversation,
  ConversationSummary,
  CreateCharacterInput,
  CreateMemoryInput,
  GeneratedImage,
  ImageKind,
  Memory,
  Message,
  Role,
  UpdateCharacterInput,
  UpdateMemoryInput,
  UpsertSummaryInput,
} from '@/types'
import { createId } from '@/utils/id'
import { isTauri, tauriInvoke } from './tauri'
import seedCharacters from '@/data/default_characters.json'

const STORAGE_KEYS = {
  conversations: 'mla_conversations',
  messages: 'mla_messages',
  characters: 'mla_characters',
  settings: 'mla_settings',
  images: 'mla_generated_images',
  memories: 'mla_memories',
  summaries: 'mla_summaries',
  participants: 'mla_participants',
} as const

/**
 * Every field a character has beyond its name, with the value a brand-new character
 * starts from. One object, so the TS type, the SQL defaults and the seed file have a
 * single place to agree.
 */
export const CHARACTER_DEFAULTS: Omit<CharacterDraft, 'name'> = {
  description: '',
  system_prompt: '',
  temperature: 0.7,
  pronouns: '',
  backstory: '',
  personality_traits: [],
  strengths: '',
  weaknesses: '',
  quirks: '',
  core_values: '',
  interests: [],
  speaking_style: '',
  response_length: 'medium',
  emoji_usage: 'rare',
  relationship_to_user: '',
  user_alias: '',
  scenario: '',
  greeting: '',
  example_dialogue: [],
  boundaries: '',
  memory_enabled: true,
  key_memories: '',
  appearance_prompt: '',
  appearance_negative_prompt: '',
  appearance_seed: null,
  avatar_path: null,
  avatar_variant: 0,
  can_send_images: true,
  selfie_style_prompt: '',
  top_p: null,
  max_tokens: null,
  prompt_override_enabled: false,
}

const DEFAULT_CHARACTERS = seedCharacters as Partial<CharacterDraft>[]

/**
 * Fills in fields a stored record predates. Applied on the way out of every read in
 * BOTH branches: localStorage has no migration mechanism at all, and this also keeps
 * the frontend working against a Rust build that hasn't caught up yet.
 */
function normalizeCharacter(raw: Partial<Character>): Character {
  return {
    ...CHARACTER_DEFAULTS,
    ...(raw as Partial<CharacterDraft>),
    id: raw.id ?? createId(),
    name: raw.name ?? 'Unnamed',
    created_at: raw.created_at ?? nowIso(),
    updated_at: raw.updated_at,
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  model_path: null,
  model_name: null,
  context_size: 4096,
  gpu_layers: 99,
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 2048,
  active_character_id: null,
  llama_host: '127.0.0.1',
  llama_port: 8080,
  llama_binary_path: null,
  image_model_path: null,
  image_model_name: null,
  image_resolution: '512x512',
  image_steps: 20,
  image_cfg_scale: 7,
  image_sampler: 'euler_a',
  image_seed: -1,
  image_random_seed: true,
  image_enhance_prompt: true,
  image_format: 'png',
  image_backend: 'mlx',
  image_binary_path: null,
  image_negative_prompt:
    'blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, text',
  user_name: '',
  user_persona: '',
  memory_enabled: true,
  memory_max_facts: 200,
  auto_image_enabled: true,
  auto_image_max_per_conversation: 10,
  auto_image_cooldown_turns: 2,
  image_style_suffix:
    'amateur phone photo, natural lighting, candid, shallow depth of field, photorealistic',
  avatar_resolution: '512x512',
  group_replies_per_turn: 1,
}

function nowIso() {
  return new Date().toISOString()
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLocal<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

function ensureLocalSeed() {
  const characters = readLocal<Character[]>(STORAGE_KEYS.characters, [])
  if (characters.length === 0) {
    const seeded: Character[] = DEFAULT_CHARACTERS.map((c) =>
      normalizeCharacter({ ...c, id: createId(), created_at: nowIso() }),
    )
    writeLocal(STORAGE_KEYS.characters, seeded)
    const settings = readLocal<AppSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS)
    settings.active_character_id = seeded[0]?.id ?? null
    writeLocal(STORAGE_KEYS.settings, settings)
  }
  if (!localStorage.getItem(STORAGE_KEYS.conversations)) {
    writeLocal(STORAGE_KEYS.conversations, [])
  }
  if (!localStorage.getItem(STORAGE_KEYS.messages)) {
    writeLocal(STORAGE_KEYS.messages, [])
  }
  if (!localStorage.getItem(STORAGE_KEYS.settings)) {
    writeLocal(STORAGE_KEYS.settings, DEFAULT_SETTINGS)
  }
  if (!localStorage.getItem(STORAGE_KEYS.memories)) {
    writeLocal(STORAGE_KEYS.memories, [])
  }
  if (!localStorage.getItem(STORAGE_KEYS.images)) {
    writeLocal(STORAGE_KEYS.images, [])
  }
}

// ── Conversations ──────────────────────────────────────────────

export async function listConversations(): Promise<Conversation[]> {
  if (isTauri()) {
    return tauriInvoke<Conversation[]>('list_conversations')
  }
  ensureLocalSeed()
  const items = readLocal<Conversation[]>(STORAGE_KEYS.conversations, [])
  return items.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  )
}

export async function createConversation(
  title = 'New Chat',
  characterId?: string | null,
): Promise<Conversation> {
  if (isTauri()) {
    return tauriInvoke<Conversation>('create_conversation', {
      title,
      characterId: characterId ?? null,
    })
  }
  ensureLocalSeed()
  const conv: Conversation = {
    id: createId(),
    title,
    character_id: characterId ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  const items = readLocal<Conversation[]>(STORAGE_KEYS.conversations, [])
  items.unshift(conv)
  writeLocal(STORAGE_KEYS.conversations, items)
  return conv
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, 'title' | 'character_id'>>,
): Promise<Conversation> {
  if (isTauri()) {
    return tauriInvoke<Conversation>('update_conversation', { id, patch })
  }
  const items = readLocal<Conversation[]>(STORAGE_KEYS.conversations, [])
  const idx = items.findIndex((c) => c.id === id)
  if (idx < 0) throw new Error('Conversation not found')
  items[idx] = { ...items[idx], ...patch, updated_at: nowIso() }
  writeLocal(STORAGE_KEYS.conversations, items)
  return items[idx]
}

export async function deleteConversation(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('delete_conversation', { id })
  }
  const items = readLocal<Conversation[]>(STORAGE_KEYS.conversations, []).filter(
    (c) => c.id !== id,
  )
  writeLocal(STORAGE_KEYS.conversations, items)
  const messages = readLocal<Message[]>(STORAGE_KEYS.messages, []).filter(
    (m) => m.conversation_id !== id,
  )
  const participants = readLocal<Record<string, string[]>>(
    STORAGE_KEYS.participants,
    {},
  )
  delete participants[id]
  writeLocal(STORAGE_KEYS.participants, participants)
  writeLocal(STORAGE_KEYS.messages, messages)
  const images = readLocal<GeneratedImage[]>(STORAGE_KEYS.images, []).filter(
    (img) => img.conversation_id !== id,
  )
  writeLocal(STORAGE_KEYS.images, images)
}

export async function touchConversation(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('touch_conversation', { id })
  }
  const items = readLocal<Conversation[]>(STORAGE_KEYS.conversations, [])
  const idx = items.findIndex((c) => c.id === id)
  if (idx >= 0) {
    items[idx].updated_at = nowIso()
    writeLocal(STORAGE_KEYS.conversations, items)
  }
}

// ── Messages ───────────────────────────────────────────────────

export async function listMessages(conversationId: string): Promise<Message[]> {
  if (isTauri()) {
    return tauriInvoke<Message[]>('list_messages', { conversationId })
  }
  ensureLocalSeed()
  const images = readLocal<GeneratedImage[]>(STORAGE_KEYS.images, [])
  return readLocal<Message[]>(STORAGE_KEYS.messages, [])
    .filter((m) => m.conversation_id === conversationId)
    // Attached by message id, not by role: a character selfie hangs off its
    // assistant message rather than a standalone role:'image' row.
    .map((m) => ({
      ...m,
      image: images.find((img) => img.message_id === m.id) ?? null,
    }))
    .sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
}

export async function addMessage(
  conversationId: string,
  role: Role,
  content: string,
  characterId?: string | null,
): Promise<Message> {
  if (isTauri()) {
    return tauriInvoke<Message>('add_message', {
      conversationId,
      role,
      content,
      characterId: characterId ?? null,
    })
  }
  const message: Message = {
    id: createId(),
    conversation_id: conversationId,
    role,
    content,
    created_at: nowIso(),
    character_id: characterId ?? null,
  }
  const items = readLocal<Message[]>(STORAGE_KEYS.messages, [])
  items.push(message)
  writeLocal(STORAGE_KEYS.messages, items)
  await touchConversation(conversationId)
  return message
}

// ── Group participants ─────────────────────────────────────────

export async function listParticipants(
  conversationId: string,
): Promise<string[]> {
  if (isTauri()) {
    return tauriInvoke<string[]>('list_participants', { conversationId })
  }
  const all = readLocal<Record<string, string[]>>(STORAGE_KEYS.participants, {})
  return all[conversationId] ?? []
}

/** Replaces the cast; the first entry becomes the conversation's primary character. */
export async function setParticipants(
  conversationId: string,
  characterIds: string[],
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('set_participants', { conversationId, characterIds })
  }
  const all = readLocal<Record<string, string[]>>(STORAGE_KEYS.participants, {})
  all[conversationId] = characterIds
  writeLocal(STORAGE_KEYS.participants, all)
  if (characterIds[0]) {
    await updateConversation(conversationId, { character_id: characterIds[0] })
  }
}

export async function updateMessageContent(
  id: string,
  content: string,
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('update_message_content', { id, content })
  }
  const messages = readLocal<Message[]>(STORAGE_KEYS.messages, [])
  const idx = messages.findIndex((m) => m.id === id)
  if (idx >= 0) {
    messages[idx].content = content
    writeLocal(STORAGE_KEYS.messages, messages)
  }
}

// ── Characters ─────────────────────────────────

export async function listCharacters(): Promise<Character[]> {
  if (isTauri()) {
    const items = await tauriInvoke<Character[]>('list_characters')
    return items.map(normalizeCharacter)
  }
  ensureLocalSeed()
  return readLocal<Character[]>(STORAGE_KEYS.characters, []).map(normalizeCharacter)
}

export async function createCharacter(
  input: CreateCharacterInput,
): Promise<Character> {
  if (isTauri()) {
    const created = await tauriInvoke<Character>('create_character', {
      input: { ...CHARACTER_DEFAULTS, ...input },
    })
    return normalizeCharacter(created)
  }
  ensureLocalSeed()
  const character = normalizeCharacter({
    ...input,
    id: createId(),
    created_at: nowIso(),
  })
  const items = readLocal<Character[]>(STORAGE_KEYS.characters, [])
  items.push(character)
  writeLocal(STORAGE_KEYS.characters, items)
  return character
}

export async function updateCharacter(
  input: UpdateCharacterInput,
): Promise<Character> {
  if (isTauri()) {
    const updated = await tauriInvoke<Character>('update_character', { input })
    return normalizeCharacter(updated)
  }
  const items = readLocal<Character[]>(STORAGE_KEYS.characters, [])
  const idx = items.findIndex((c) => c.id === input.id)
  if (idx < 0) throw new Error('Character not found')
  const { id: _id, ...rest } = input
  items[idx] = normalizeCharacter({
    ...items[idx],
    ...rest,
    updated_at: nowIso(),
  })
  writeLocal(STORAGE_KEYS.characters, items)
  return items[idx]
}

export async function deleteCharacter(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('delete_character', { id })
  }
  const items = readLocal<Character[]>(STORAGE_KEYS.characters, []).filter(
    (c) => c.id !== id,
  )
  writeLocal(STORAGE_KEYS.characters, items)
  const memories = readLocal<Memory[]>(STORAGE_KEYS.memories, []).filter(
    (m) => m.character_id !== id,
  )
  writeLocal(STORAGE_KEYS.memories, memories)
}

// ── Memories ──────────────────────────────────

export async function listMemories(
  characterId?: string | null,
): Promise<Memory[]> {
  if (isTauri()) {
    return tauriInvoke<Memory[]>('list_memories', {
      characterId: characterId ?? null,
    })
  }
  const all = readLocal<Memory[]>(STORAGE_KEYS.memories, [])
  const scoped = characterId
    ? all.filter((m) => m.character_id === characterId)
    : all
  return scoped.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) || b.importance - a.importance,
  )
}

export async function createMemory(input: CreateMemoryInput): Promise<Memory> {
  if (isTauri()) {
    return tauriInvoke<Memory>('create_memory', { input })
  }
  const ts = nowIso()
  const memory: Memory = {
    id: createId(),
    character_id: input.character_id ?? null,
    conversation_id: input.conversation_id ?? null,
    kind: input.kind ?? 'fact',
    content: input.content,
    keywords: input.keywords ?? '',
    importance: input.importance ?? 0.5,
    pinned: input.pinned ?? false,
    source_message_id: input.source_message_id ?? null,
    hits: 0,
    created_at: ts,
    updated_at: ts,
    last_accessed_at: null,
  }
  const items = readLocal<Memory[]>(STORAGE_KEYS.memories, [])
  const duplicate = items.some(
    (m) =>
      m.character_id === memory.character_id &&
      m.kind === memory.kind &&
      m.content === memory.content,
  )
  if (!duplicate) {
    items.push(memory)
    writeLocal(STORAGE_KEYS.memories, items)
  }
  return memory
}

export async function updateMemory(input: UpdateMemoryInput): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('update_memory', { input })
  }
  const items = readLocal<Memory[]>(STORAGE_KEYS.memories, [])
  const idx = items.findIndex((m) => m.id === input.id)
  if (idx < 0) return
  const { id: _id, touch_access, ...rest } = input
  const defined = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  )
  items[idx] = {
    ...items[idx],
    ...defined,
    updated_at: nowIso(),
    last_accessed_at: touch_access ? nowIso() : items[idx].last_accessed_at,
  }
  writeLocal(STORAGE_KEYS.memories, items)
}

export async function deleteMemory(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('delete_memory', { id })
  }
  writeLocal(
    STORAGE_KEYS.memories,
    readLocal<Memory[]>(STORAGE_KEYS.memories, []).filter((m) => m.id !== id),
  )
}

export async function deleteMemoriesForCharacter(
  characterId: string,
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('delete_memories_for_character', { characterId })
  }
  writeLocal(
    STORAGE_KEYS.memories,
    readLocal<Memory[]>(STORAGE_KEYS.memories, []).filter(
      (m) => m.character_id !== characterId,
    ),
  )
}

// ── Conversation summaries ────────────────────────

export async function getConversationSummary(
  conversationId: string,
): Promise<ConversationSummary | null> {
  if (isTauri()) {
    return tauriInvoke<ConversationSummary | null>('get_conversation_summary', {
      conversationId,
    })
  }
  const all = readLocal<ConversationSummary[]>(STORAGE_KEYS.summaries, [])
  return all.find((x) => x.conversation_id === conversationId) ?? null
}

export async function upsertConversationSummary(
  input: UpsertSummaryInput,
): Promise<ConversationSummary | null> {
  if (isTauri()) {
    return tauriInvoke<ConversationSummary | null>(
      'upsert_conversation_summary',
      { input },
    )
  }
  const all = readLocal<ConversationSummary[]>(STORAGE_KEYS.summaries, [])
  const idx = all.findIndex((x) => x.conversation_id === input.conversation_id)
  const currentVersion = idx >= 0 ? all[idx].version : 0
  if (
    input.expected_version != null &&
    input.expected_version !== currentVersion
  ) {
    return null
  }
  const next: ConversationSummary = {
    conversation_id: input.conversation_id,
    summary: input.summary,
    summarized_up_to_message_id: input.summarized_up_to_message_id,
    summarized_up_to_created_at: input.summarized_up_to_created_at,
    message_count: input.message_count,
    token_estimate: input.token_estimate,
    version: currentVersion + 1,
    updated_at: nowIso(),
  }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  writeLocal(STORAGE_KEYS.summaries, all)
  return next
}

export async function clearConversationSummary(
  conversationId: string,
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('clear_conversation_summary', { conversationId })
  }
  writeLocal(
    STORAGE_KEYS.summaries,
    readLocal<ConversationSummary[]>(STORAGE_KEYS.summaries, []).filter(
      (x) => x.conversation_id !== conversationId,
    ),
  )
}

export async function countImagesOfKind(
  conversationId: string,
  kind: ImageKind,
): Promise<number> {
  if (isTauri()) {
    return tauriInvoke<number>('count_images_of_kind', { conversationId, kind })
  }
  return readLocal<GeneratedImage[]>(STORAGE_KEYS.images, []).filter(
    (img) => img.conversation_id === conversationId && img.kind === kind,
  ).length
}

// ── Avatars ──────────────────────────────────

/**
 * Moves a freshly generated image into the avatars directory under a
 * variant-stamped name. Outside Tauri the mock provider hands back a data URL,
 * which is already directly usable as an `<img>` src.
 */
export async function saveCharacterAvatar(
  sourcePath: string,
  characterId: string,
  variant: number,
): Promise<string> {
  if (isTauri()) {
    return tauriInvoke<string>('save_character_avatar', {
      sourcePath,
      characterId,
      variant,
    })
  }
  return sourcePath
}

export async function deleteCharacterAvatar(path: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('delete_character_avatar', { path })
  }
}

// ── Settings ───────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  if (isTauri()) {
    const settings = await tauriInvoke<AppSettings>('get_settings')
    return { ...DEFAULT_SETTINGS, ...settings }
  }
  ensureLocalSeed()
  return {
    ...DEFAULT_SETTINGS,
    ...readLocal<AppSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  }
}

// ── Generated images ───────────────────────────────────────────

export interface CreateGeneratedImageInput {
  conversation_id: string
  message_id: string
  original_prompt: string
  enhanced_prompt: string
  image_path: string
  width: number
  height: number
  seed: number
  sampler: string
  steps: number
  cfg: number
  generation_time_ms: number
  caption?: string
  kind?: ImageKind
}

export async function createGeneratedImage(
  input: CreateGeneratedImageInput,
): Promise<GeneratedImage> {
  if (isTauri()) {
    return tauriInvoke<GeneratedImage>('create_generated_image', {
      input: { caption: '', kind: 'user_request', ...input },
    })
  }
  const image: GeneratedImage = {
    id: createId(),
    caption: '',
    kind: 'user_request',
    ...input,
    created_at: nowIso(),
  }
  const items = readLocal<GeneratedImage[]>(STORAGE_KEYS.images, [])
  items.push(image)
  writeLocal(STORAGE_KEYS.images, items)
  return image
}

export async function deleteMessage(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('delete_message', { id })
  }
  const messages = readLocal<Message[]>(STORAGE_KEYS.messages, []).filter(
    (m) => m.id !== id,
  )
  writeLocal(STORAGE_KEYS.messages, messages)
  const images = readLocal<GeneratedImage[]>(STORAGE_KEYS.images, []).filter(
    (img) => img.message_id !== id,
  )
  writeLocal(STORAGE_KEYS.images, images)
}

export async function searchConversations(query: string): Promise<Conversation[]> {
  if (isTauri()) {
    return tauriInvoke<Conversation[]>('search_conversations', { query })
  }
  ensureLocalSeed()
  const q = query.trim().toLowerCase()
  if (!q) return listConversations()

  const conversations = readLocal<Conversation[]>(STORAGE_KEYS.conversations, [])
  const messages = readLocal<Message[]>(STORAGE_KEYS.messages, [])
  const images = readLocal<GeneratedImage[]>(STORAGE_KEYS.images, [])

  return conversations
    .filter((c) => {
      if (c.title.toLowerCase().includes(q)) return true
      const msgs = messages.filter((m) => m.conversation_id === c.id)
      if (msgs.some((m) => m.content.toLowerCase().includes(q))) return true
      const imgs = images.filter((i) => i.conversation_id === c.id)
      return imgs.some(
        (i) =>
          i.original_prompt.toLowerCase().includes(q) ||
          i.enhanced_prompt.toLowerCase().includes(q),
      )
    })
    .sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
}

export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  if (isTauri()) {
    // Rust round-trips the blob through serde, so fields it doesn't know about come
    // back missing. Without this spread the first update after adding a setting
    // writes an un-defaulted object into the store.
    const next = await tauriInvoke<AppSettings>('update_settings', { patch })
    return { ...DEFAULT_SETTINGS, ...next }
  }
  const current = await getSettings()
  const next = { ...current, ...patch }
  writeLocal(STORAGE_KEYS.settings, next)
  return next
}

// ── Engine ─────────────────────────────────────────────────────

export interface EngineStatusResponse {
  status: string
  message: string
  progress: number
  model_loaded: string | null
  error?: string | null
}

export async function getEngineStatus(): Promise<EngineStatusResponse> {
  if (isTauri()) {
    return tauriInvoke<EngineStatusResponse>('get_engine_status')
  }
  // Browser dev: probe localhost directly
  try {
    const ok = await fetch('http://127.0.0.1:8080/health', {
      signal: AbortSignal.timeout(1500),
    })
      .then((r) => r.ok)
      .catch(() => false)
    if (ok) {
      return {
        status: 'ready',
        message: 'Connected to local llama-server',
        progress: 100,
        model_loaded: 'external',
      }
    }
  } catch {
    /* ignore */
  }
  return {
    status: 'no_model',
    message: 'Start llama-server or open the app via Tauri',
    progress: 0,
    model_loaded: null,
  }
}

export async function startEngine(): Promise<EngineStatusResponse> {
  if (isTauri()) {
    return tauriInvoke<EngineStatusResponse>('start_engine')
  }
  return getEngineStatus()
}

export async function stopEngine(): Promise<void> {
  if (isTauri()) {
    return tauriInvoke('stop_engine')
  }
}

export async function pickModelFile(): Promise<string | null> {
  if (isTauri()) {
    return tauriInvoke<string | null>('pick_model_file')
  }
  return null
}

export async function getModelsDir(): Promise<string> {
  if (isTauri()) {
    return tauriInvoke<string>('get_models_dir')
  }
  return '~/Library/Application Support/MyLocalAI/models'
}

export async function listLocalModels(): Promise<string[]> {
  if (isTauri()) {
    return tauriInvoke<string[]>('list_local_models')
  }
  return []
}
