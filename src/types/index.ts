export type Role = 'system' | 'user' | 'assistant' | 'image'

export interface Character {
  id: string
  name: string
  description: string
  system_prompt: string
  temperature: number
  created_at: string
  updated_at?: string
}

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
}

export interface Message {
  id: string
  conversation_id: string
  role: Role
  /** For image messages: original user prompt (searchable). Otherwise message text. */
  content: string
  created_at: string
  /** Present when role === 'image' */
  image?: GeneratedImage | null
}

/** Future-ready memory entry for long-term personalization */
export interface Memory {
  id: string
  content: string
  source_message_id?: string
  importance: number
  created_at: string
  last_accessed_at?: string
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

export interface CreateCharacterInput {
  name: string
  description: string
  system_prompt: string
  temperature: number
}

export interface UpdateCharacterInput extends Partial<CreateCharacterInput> {
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
  output_path?: string
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
