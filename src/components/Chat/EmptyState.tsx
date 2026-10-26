import { ImageIcon, Sparkles, Wand2 } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useConversationCharacter } from '@/hooks/useConversationCharacter'
import { hasRichPersona } from '@/services/personaPrompt'
import { Avatar } from '@/components/UI/Avatar'
import { Button } from '@/components/UI/Button'

const SUGGESTIONS = [
  'Explain quantum computing simply',
  'Help me debug a Python script',
  'Write a short sci-fi story opening',
  'Plan a productive morning routine',
]

const IMAGE_SUGGESTIONS = [
  'A futuristic Tokyo skyline at night',
  'A majestic red dragon over snowy mountains',
  'Oil painting of Paris in golden hour',
  'A realistic lion in the savanna',
]

export function EmptyState() {
  const sendMessage = useChatStore((s) => s.sendMessage)
  const setImageMode = useChatStore((s) => s.setImageMode)
  const generateImage = useChatStore((s) => s.generateImage)
  const newChat = useChatStore((s) => s.newChat)
  const character = useConversationCharacter()
  const isPersona = character ? hasRichPersona(character) : false

  // A full persona gets an introduction rather than a product splash screen.
  if (character && isPersona) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 animate-fade-in">
        <Avatar character={character} size="xl" ring />
        <h1 className="mb-1 mt-5 text-2xl font-semibold tracking-tight">
          {character.name}
        </h1>
        {character.description && (
          <p className="mb-4 max-w-md text-center text-[15px] text-muted">
            {character.description}
          </p>
        )}
        {character.scenario && (
          <p className="mb-6 max-w-md text-center text-sm italic text-muted-dim">
            {character.scenario}
          </p>
        )}
        <Button variant="accent" onClick={() => void newChat(character.id)}>
          Start talking
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 animate-fade-in">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-card border border-border shadow-lg shadow-black/20">
        <Sparkles className="h-7 w-7 text-accent" strokeWidth={1.75} />
      </div>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">My Local AI</h1>
      <p className="mb-1 max-w-md text-center text-[15px] text-muted">
        Private AI assistant running on your Mac.
      </p>
      <p className="mb-8 text-sm text-muted-dim">
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

      <div className="mt-8 w-full max-w-xl">
        <div className="mb-2.5 flex items-center gap-2 px-1">
          <ImageIcon className="h-3.5 w-3.5 text-accent" />
          <p className="text-xs font-medium uppercase tracking-wide text-muted-dim">
            Generate an image
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {IMAGE_SUGGESTIONS.map((text) => (
            <button
              key={text}
              onClick={() => {
                setImageMode(true)
                void generateImage(text)
              }}
              className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent-soft/40 px-4 py-3 text-left text-sm text-muted transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-white"
            >
              <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              {text}
            </button>
          ))}
        </div>
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
