export type Role = 'system' | 'user' | 'assistant' | 'image'

export type ResponseLength = 'terse' | 'short' | 'medium' | 'long' | 'verbose'
export type EmojiUsage = 'none' | 'rare' | 'frequent'

/** One style sample: how the user speaks, how the character answers. */
export interface ExampleExchange {
  user: string
  character: string
}

export interface Character {
  id: string
  name: string
  /** Short tagline, shown in the header and the gallery. */
  description: string
  /** Verbatim system prompt. Used as-is when `prompt_override_enabled`. */
  system_prompt: string
  temperature: number
  created_at: string
  updated_at?: string

  // Identity
  pronouns: string
  backstory: string

  // Personality
  personality_traits: string[]
  strengths: string
  weaknesses: string
  quirks: string
  core_values: string
  interests: string[]

  // Voice
  speaking_style: string
  response_length: ResponseLength
  emoji_usage: EmojiUsage

  // Relationship and scene
  relationship_to_user: string
  /** What this character calls you. */
  user_alias: string
  scenario: string
  greeting: string
  example_dialogue: ExampleExchange[]
  boundaries: string

  // Memory
  memory_enabled: boolean
  /** Author-written seed memories. Always injected, never decayed. */
  key_memories: string

  // Appearance and images
  /** Injected verbatim into every image this character appears in. */
  appearance_prompt: string
  appearance_negative_prompt: string
  /** Locked identity seed. null until the first avatar is generated. */
  appearance_seed: number | null
  avatar_path: string | null
  /** Bumped on every re-roll so the webview cannot serve a cached old face. */
  avatar_variant: number
  can_send_images: boolean
  selfie_style_prompt: string

  // Generation overrides (null = fall back to AppSettings)
  top_p: number | null
  max_tokens: number | null
  /** Use `system_prompt` verbatim and ignore the persona fields. */
  prompt_override_enabled: boolean
}

export type CharacterDraft = Omit<Character, 'id' | 'created_at' | 'updated_at'>

export interface Conversation {
  id: string
  title: string
  character_id: string | null
  created_at: string
  updated_at: string
}

/** Metadata for a generated image attached to an image-role message */
export interface GeneratedImage {
  id: string
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
  created_at: string
  generation_time_ms: number
  /** For a character selfie: the scene the character described. */
  caption: string
  kind: ImageKind
}

export type ImageKind = 'user_request' | 'character_selfie' | 'avatar'

export interface Message {
  id: string
  conversation_id: string
  role: Role
  /** For image messages: original user prompt (searchable). Otherwise message text. */
  content: string
  created_at: string
  /** Which character said it. null for user messages and for pre-group replies. */
  character_id?: string | null
  /** The photo attached to this message, if any. */
  image?: GeneratedImage | null
}

export type MemoryKind =
  | 'identity'
  | 'preference'
  | 'relationship'
  | 'event'
  | 'promise'
  | 'emotion'
  | 'fact'
  | 'pinned'

/** A durable fact the character remembers about you, across conversations. */
export interface Memory {
  id: string
  character_id: string | null
  conversation_id: string | null
  kind: MemoryKind
  content: string
  /** Lowercase, space-separated. Computed locally; powers embedding-free recall. */
  keywords: string
  importance: number
  pinned: boolean
  source_message_id?: string | null
  hits: number
  created_at: string
  updated_at: string
  last_accessed_at?: string | null
}

export interface CreateMemoryInput {
  character_id?: string | null
  conversation_id?: string | null
  kind?: MemoryKind
  content: string
  keywords?: string
  importance?: number
  pinned?: boolean
  source_message_id?: string | null
}

export interface UpdateMemoryInput {
  id: string
  content?: string
  keywords?: string
  kind?: MemoryKind
  importance?: number
  pinned?: boolean
  hits?: number
  touch_access?: boolean
}

/** Rolling background summary of everything older than the live message window. */
export interface ConversationSummary {
  conversation_id: string
  summary: string
  summarized_up_to_message_id: string | null
  summarized_up_to_created_at: string | null
  message_count: number
  token_estimate: number
  version: number
  updated_at: string
}

export interface UpsertSummaryInput {
  conversation_id: string
  summary: string
  summarized_up_to_message_id: string | null
  summarized_up_to_created_at: string | null
  message_count: number
  token_estimate: number
  /** Version read before the LLM call; a stale write is discarded, not applied. */
  expected_version?: number | null
}

export type ImageResolution = '512x512' | '768x768' | '1024x1024'
export type ImageFormat = 'png' | 'jpeg'
export type ImageBackend = 'sdcpp' | 'mlx'
export type ImageSampler =
  | 'euler'
  | 'euler_a'
  | 'heun'
  | 'dpm2'
  | 'dpm++2m'
  | 'dpm++2s_a'
  | 'lms'
  | 'ddim'

export interface AppSettings {
  model_path: string | null
  model_name: string | null
  context_size: number
  gpu_layers: number
  temperature: number
  top_p: number
  max_tokens: number
  active_character_id: string | null
  llama_host: string
  llama_port: number
  llama_binary_path: string | null

  // Image generation
  image_model_path: string | null
  image_model_name: string | null
  image_resolution: ImageResolution
  image_steps: number
  image_cfg_scale: number
  image_sampler: ImageSampler
  image_seed: number
  image_random_seed: boolean
  image_enhance_prompt: boolean
  image_format: ImageFormat
  image_backend: ImageBackend
  image_binary_path: string | null
  image_negative_prompt: string

  // Who the characters are talking to
  user_name: string
  user_persona: string

  // Memory
  memory_enabled: boolean
  memory_max_facts: number

  // Character-initiated photos
  auto_image_enabled: boolean
  auto_image_max_per_conversation: number
  auto_image_cooldown_turns: number
  image_style_suffix: string
  avatar_resolution: ImageResolution

  // Group conversations
  group_replies_per_turn: number
}

export type EngineStatus =
  | 'idle'
  | 'checking'
  | 'starting'
  | 'loading'
  | 'ready'
  | 'error'
  | 'no_model'

export interface EngineState {
  status: EngineStatus
  message: string
  progress: number
  model_loaded: string | null
  error?: string
}

export interface ChatCompletionMessage {
  role: Role
  content: string
}

export interface StreamChunk {
  id?: string
  object?: string
  choices?: Array<{
    index: number
    delta: { role?: string; content?: string }
    finish_reason: string | null
  }>
}

export type CreateCharacterInput = Pick<CharacterDraft, 'name'> & Partial<CharacterDraft>

export interface UpdateCharacterInput extends Partial<CharacterDraft> {
  id: string
}

/** In-flight image generation placeholder shown in the chat */
export interface ImageGenerationJob {
  id: string
  conversation_id: string
  original_prompt: string
  enhanced_prompt: string | null
  progress: number
  status: 'enhancing' | 'generating' | 'error'
  error?: string
  estimated_seconds?: number
  started_at: number
}

export interface ImageGenerationRequest {
  prompt: string
  negative_prompt?: string
  width: number
  height: number
  steps: number
  cfg_scale: number
  seed: number
  sampler: string
  model_path: string
  format: ImageFormat
}

export interface ImageGenerationResult {
  image_path: string
  width: number
  height: number
  seed: number
  generation_time_ms: number
}

export interface ImageGenProgressEvent {
  job_id: string
  progress: number
  step?: number
  total_steps?: number
  message?: string
}
