import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
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
  const setConversationCharacter = useChatStore((s) => s.setConversationCharacter)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const phaseLabel = PHASE_LABEL[turnPhase]

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Top bar */}
      <header className="titlebar-drag flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4 sm:px-6">
        <div className="titlebar-no-drag relative flex min-w-0 items-center gap-2.5 pl-16 sm:pl-0">
          <Avatar character={character} size="sm" />
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex min-w-0 items-center gap-1 text-sm font-medium text-white transition hover:text-accent"
          >
            <span className="truncate">{character?.name ?? 'My Local AI'}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
          </button>
          {character?.description && (
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
              <div className="absolute left-0 top-9 z-50 w-60 overflow-hidden rounded-xl border border-border bg-sidebar py-1 shadow-2xl shadow-black/40">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      if (activeConversationId) {
                        void setConversationCharacter(activeConversationId, c.id)
                      }
                      setSwitcherOpen(false)
                    }}
                    disabled={!activeConversationId}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                      c.id === character?.id
                        ? 'bg-accent-soft text-white'
                        : 'text-muted hover:bg-card hover:text-white',
                      !activeConversationId && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Avatar character={c} size="xs" />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
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
              {phaseLabel}
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
