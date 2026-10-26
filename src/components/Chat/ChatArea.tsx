import { useState } from 'react'
import { Check, ChevronDown, Users } from 'lucide-react'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { useCharacterStore } from '@/stores/characterStore'
import { useEngineStore } from '@/stores/engineStore'
import { useChatStore } from '@/stores/chatStore'
import { useConversationCharacter } from '@/hooks/useConversationCharacter'
import { Avatar } from '@/components/UI/Avatar'
import { cn } from '@/utils/cn'

interface ChatAreaProps {
  onOpenSettings?: () => void
  onOpenCharacters?: () => void
}

/** What the character is doing right now, when it is more than just typing. */
const PHASE_LABEL: Record<string, string> = {
  composing_image: 'Taking a photo',
  engine_pausing: 'Taking a photo',
  generating_image: 'Sending a photo',
  engine_resuming: 'Picking the thread back up',
}

export function ChatArea({ onOpenSettings, onOpenCharacters }: ChatAreaProps) {
  const characters = useCharacterStore((s) => s.characters)
  const character = useConversationCharacter()
  const status = useEngineStore((s) => s.status)
  const modelLoaded = useEngineStore((s) => s.model_loaded)
  const turnPhase = useChatStore((s) => s.turnPhase)
  const imageMode = useChatStore((s) => s.imageMode)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const participantIds = useChatStore((s) => s.participantIds)
  const setParticipants = useChatStore((s) => s.setConversationParticipants)
  const speakingCharacterId = useChatStore((s) => s.speakingCharacterId)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const phaseLabel = PHASE_LABEL[turnPhase]

  const cast = participantIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
  const present = cast.length ? cast : character ? [character] : []
  const speaking = speakingCharacterId
    ? characters.find((c) => c.id === speakingCharacterId)
    : null

  const title =
    present.length > 2
      ? `${present[0].name} +${present.length - 1}`
      : present.map((c) => c.name).join(' & ') || 'My Local AI'

  // `present` rather than the raw ids: a conversation from before group chats has no
  // participant rows yet, and toggling against [] would replace its character instead
  // of adding to it.
  const presentIds = present.map((c) => c.id)

  /** At least one character has to stay: a chat with nobody in it can't reply. */
  const toggle = (id: string) => {
    const next = presentIds.includes(id)
      ? presentIds.filter((x) => x !== id)
      : [...presentIds, id]
    if (!next.length) return
    void setParticipants(next)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Top bar */}
      <header className="titlebar-drag flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4 sm:px-6">
        <div className="titlebar-no-drag relative flex min-w-0 items-center gap-2.5 pl-16 sm:pl-0">
          <span className="flex shrink-0 items-center -space-x-2">
            {present.slice(0, 3).map((c) => (
              <Avatar
                key={c.id}
                character={c}
                size="sm"
                ring={present.length > 1 && c.id === speaking?.id}
                className="border border-app"
              />
            ))}
          </span>
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex min-w-0 items-center gap-1 text-sm font-medium text-white transition hover:text-accent"
          >
            <span className="truncate">{title}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
          </button>
          {present.length === 1 && character?.description && (
            <span className="hidden truncate text-xs text-muted sm:inline">
              · {character.description}
            </span>
          )}

          {switcherOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setSwitcherOpen(false)}
              />
              <div className="absolute left-0 top-9 z-50 w-64 overflow-hidden rounded-xl border border-border bg-sidebar py-1 shadow-2xl shadow-black/40">
                <p className="flex items-center gap-1.5 px-3 pb-1.5 pt-1 text-[11px] uppercase tracking-wide text-muted-dim">
                  <Users className="h-3 w-3" /> In this chat
                </p>
                {characters.map((c) => {
                  const inChat = presentIds.includes(c.id)
                  const lastOne = inChat && presentIds.length === 1
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      disabled={!activeConversationId || lastOne}
                      title={
                        lastOne
                          ? 'Someone has to be in the chat'
                          : inChat
                            ? `Remove ${c.name}`
                            : `Add ${c.name}`
                      }
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                        inChat ? 'text-white' : 'text-muted hover:text-white',
                        'hover:bg-card',
                        (!activeConversationId || lastOne) &&
                          'cursor-not-allowed opacity-60',
                      )}
                    >
                      <Avatar character={c} size="xs" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {inChat && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                    </button>
                  )
                })}
                {!activeConversationId && (
                  <p className="px-3 py-2 text-[11px] text-muted-dim">
                    Start a chat first.
                  </p>
                )}
                <button
                  onClick={() => {
                    setSwitcherOpen(false)
                    onOpenCharacters?.()
                  }}
                  className="mt-1 w-full border-t border-border-subtle px-3 py-2 text-left text-xs text-muted transition hover:text-white"
                >
                  Manage characters…
                </button>
              </div>
            </>
          )}
        </div>

        <div className="titlebar-no-drag flex items-center gap-2">
          {phaseLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {speaking && present.length > 1
                ? `${speaking.name}: ${phaseLabel.toLowerCase()}`
                : phaseLabel}
            </span>
          )}
          {imageMode && !phaseLabel && (
            <span className="hidden items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-muted sm:inline-flex">
              Image mode
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
              status === 'ready'
                ? 'bg-accent-soft text-accent'
                : status === 'error'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-card text-muted',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'ready'
                  ? 'bg-accent'
                  : status === 'error'
                    ? 'bg-danger'
                    : 'bg-muted-dim',
              )}
            />
            {status === 'ready'
              ? modelLoaded
                ? modelLoaded.length > 28
                  ? modelLoaded.slice(0, 28) + '…'
                  : modelLoaded
                : 'Ready'
              : status === 'loading'
                ? 'Loading model'
                : status === 'starting'
                  ? 'Starting'
                  : status === 'no_model'
                    ? 'No model'
                    : status === 'error'
                      ? 'Error'
                      : 'Checking'}
          </span>
        </div>
      </header>

      <MessageList onOpenSettings={onOpenSettings} />
      <ChatInput onOpenSettings={onOpenSettings} />
    </div>
  )
}
