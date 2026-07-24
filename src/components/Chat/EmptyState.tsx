import { Sparkles } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useCharacterStore } from '@/stores/characterStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Button } from '@/components/UI/Button'

const SUGGESTIONS = [
  'Explain quantum computing simply',
  'Help me debug a Python script',
  'Write a short sci-fi story opening',
  'Plan a productive morning routine',
]

export function EmptyState() {
  const sendMessage = useChatStore((s) => s.sendMessage)
  const characters = useCharacterStore((s) => s.characters)
  const activeCharacterId = useSettingsStore((s) => s.settings?.active_character_id)
  const character =
    characters.find((c) => c.id === activeCharacterId) ?? characters[0] ?? null

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 animate-fade-in">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-card border border-border shadow-lg shadow-black/20">
        <Sparkles className="h-7 w-7 text-accent" strokeWidth={1.75} />
      </div>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">My Local AI</h1>
      <p className="mb-1 max-w-md text-center text-[15px] text-muted">
        Private AI assistant running on your Mac.
      </p>
      <p className="mb-10 text-sm text-muted-dim">
        {character
          ? `Chatting as ${character.name}`
          : 'Start a conversation.'}
      </p>

      <div className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => void sendMessage(text)}
            className="rounded-xl border border-border bg-card/60 px-4 py-3.5 text-left text-sm text-muted transition-all hover:border-border hover:bg-card hover:text-white"
          >
            {text}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void sendMessage('Hello! What can you help me with?')}
        >
          Or just say hello
        </Button>
      </div>
    </div>
  )
}
