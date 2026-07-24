export type Role = 'system' | 'user' | 'assistant'

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

export interface Message {
  id: string
  conversation_id: string
  role: Role
  content: string
  created_at: string
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
