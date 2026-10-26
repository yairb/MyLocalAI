import { Check, Settings2 } from 'lucide-react'
import { useCharacterStore } from '@/stores/characterStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Avatar } from '@/components/UI/Avatar'
import { Button } from '@/components/UI/Button'
import { cn } from '@/utils/cn'

/**
 * A compact roster. Creating and editing now lives in the Character Studio, which has
 * room for a persona rather than a single prompt box.
 */
export function CharacterEditor({
  onOpenCharacters,
}: {
  onOpenCharacters?: () => void
}) {
  const characters = useCharacterStore((s) => s.characters)
  const setActive = useCharacterStore((s) => s.setActive)
  const activeId = useSettingsStore((s) => s.settings?.active_character_id)

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">Your characters</p>
          <p className="mt-0.5 text-xs text-muted">
            Click one to make it the default for new chats.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenCharacters}>
          <Settings2 className="h-3.5 w-3.5" /> Manage
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {characters.map((c) => {
          const active = c.id === activeId || (!activeId && c === characters[0])
          return (
            <button
              key={c.id}
              onClick={() => void setActive(c.id)}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition',
                active
                  ? 'border-accent/40 bg-accent-soft'
                  : 'border-border bg-card/40 hover:bg-card',
              )}
            >
              <Avatar character={c} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {active && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      <Check className="h-2.5 w-2.5" /> Active
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                  {c.description || 'No description'}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
