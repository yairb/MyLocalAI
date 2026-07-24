import type {
  AppSettings,
  Character,
  Conversation,
  CreateCharacterInput,
  Message,
  Role,
  UpdateCharacterInput,
} from '@/types'
import { createId } from '@/utils/id'
import { isTauri, tauriInvoke } from './tauri'

const STORAGE_KEYS = {
  conversations: 'mla_conversations',
  messages: 'mla_messages',
  characters: 'mla_characters',
  settings: 'mla_settings',
} as const

const DEFAULT_CHARACTERS: Omit<Character, 'id' | 'created_at'>[] = [
  {
    name: 'Default Assistant',
    description: 'A helpful, clear, and concise AI assistant.',
    system_prompt:
      'You are a helpful AI assistant running locally on the user\'s Mac. Be clear, accurate, and concise. Use markdown when it improves readability. If you are unsure, say so.',
    temperature: 0.7,
  },
  {
    name: 'Friendly Companion',
    description: 'Warm, conversational, and supportive.',
    system_prompt:
      'You are a friendly companion named Alex. You are warm, encouraging, and conversational. You remember personal details the user shares in the current conversation and respond with empathy. Keep replies natural and human.',
    temperature: 0.85,
  },
  {
    name: 'Coding Expert',
    description: 'Senior engineer focused on clean, practical code.',
    system_prompt:
      'You are an expert software engineer. Prefer practical, production-quality solutions. Use clear code examples with language tags. Explain trade-offs briefly. When debugging, reason step by step. Prefer modern best practices.',
    temperature: 0.4,
  },
  {
    name: 'Creative Writer',
    description: 'Imaginative storyteller and writing partner.',
    system_prompt:
      'You are a creative writing partner. Help with stories, poems, scripts, and brainstorming. Be imaginative, vivid, and collaborative. Offer alternatives when asked. Match the tone and style the user is aiming for.',
    temperature: 0.95,
  },
]

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
    const seeded: Character[] = DEFAULT_CHARACTERS.map((c) => ({
      ...c,
      id: createId(),
      created_at: nowIso(),
    }))
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
  writeLocal(STORAGE_KEYS.messages, messages)
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
  return readLocal<Message[]>(STORAGE_KEYS.messages, [])
    .filter((m) => m.conversation_id === conversationId)
    .sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
}

export async function addMessage(
  conversationId: string,
  role: Role,
  content: string,
): Promise<Message> {
  if (isTauri()) {
    return tauriInvoke<Message>('add_message', {
      conversationId,
      role,
      content,
    })
  }
  const msg: Message = {
    id: createId(),
    conversation_id: conversationId,
    role,
    content,
    created_at: nowIso(),
  }
  const messages = readLocal<Message[]>(STORAGE_KEYS.messages, [])
  messages.push(msg)
  writeLocal(STORAGE_KEYS.messages, messages)
  await touchConversation(conversationId)
  return msg
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

// ── Characters ─────────────────────────────────────────────────

export async function listCharacters(): Promise<Character[]> {
  if (isTauri()) {
    return tauriInvoke<Character[]>('list_characters')
  }
  ensureLocalSeed()
  return readLocal<Character[]>(STORAGE_KEYS.characters, [])
}

export async function createCharacter(
  input: CreateCharacterInput,
): Promise<Character> {
  if (isTauri()) {
    return tauriInvoke<Character>('create_character', { input })
  }
  ensureLocalSeed()
  const character: Character = {
    id: createId(),
    ...input,
    created_at: nowIso(),
  }
  const items = readLocal<Character[]>(STORAGE_KEYS.characters, [])
  items.push(character)
  writeLocal(STORAGE_KEYS.characters, items)
  return character
}

export async function updateCharacter(
  input: UpdateCharacterInput,
): Promise<Character> {
  if (isTauri()) {
    return tauriInvoke<Character>('update_character', { input })
  }
  const items = readLocal<Character[]>(STORAGE_KEYS.characters, [])
  const idx = items.findIndex((c) => c.id === input.id)
  if (idx < 0) throw new Error('Character not found')
  const { id: _id, ...rest } = input
  items[idx] = { ...items[idx], ...rest, updated_at: nowIso() }
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
}

// ── Settings ───────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  if (isTauri()) {
    return tauriInvoke<AppSettings>('get_settings')
  }
  ensureLocalSeed()
  return {
    ...DEFAULT_SETTINGS,
    ...readLocal<AppSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  }
}

export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  if (isTauri()) {
    return tauriInvoke<AppSettings>('update_settings', { patch })
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
