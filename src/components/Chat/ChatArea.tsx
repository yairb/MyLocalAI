import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { useCharacterStore } from '@/stores/characterStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEngineStore } from '@/stores/engineStore'
import { cn } from '@/utils/cn'

export function ChatArea() {
  const characters = useCharacterStore((s) => s.characters)
  const activeCharacterId = useSettingsStore((s) => s.settings?.active_character_id)
  const character =
    characters.find((c) => c.id === activeCharacterId) ?? characters[0] ?? null
  const status = useEngineStore((s) => s.status)
  const modelLoaded = useEngineStore((s) => s.model_loaded)

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Top bar */}
      <header className="titlebar-drag flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4 sm:px-6">
        <div className="titlebar-no-drag flex min-w-0 items-center gap-2.5 pl-16 sm:pl-0">
          <h2 className="truncate text-sm font-medium text-white">
            {character?.name ?? 'My Local AI'}
          </h2>
          {character?.description && (
            <span className="hidden truncate text-xs text-muted sm:inline">
              · {character.description}
            </span>
          )}
        </div>
        <div className="titlebar-no-drag flex items-center gap-2">
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

      <MessageList />
      <ChatInput />
    </div>
  )
}
