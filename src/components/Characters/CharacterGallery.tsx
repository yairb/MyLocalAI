import { useState } from 'react'
import { ArrowLeft, Check, Loader2, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Character } from '@/types'
import { useCharacterStore } from '@/stores/characterStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAvatarStore } from '@/stores/avatarStore'
import { Avatar } from '@/components/UI/Avatar'
import { Button } from '@/components/UI/Button'
import { cn } from '@/utils/cn'
import { CharacterStudio } from './CharacterStudio'

export function CharacterGallery({
  onBack,
  onStartChat,
}: {
  onBack: () => void
  onStartChat: () => void
}) {
  const characters = useCharacterStore((s) => s.characters)
  const remove = useCharacterStore((s) => s.remove)
  const setActive = useCharacterStore((s) => s.setActive)
  const activeId = useSettingsStore((s) => s.settings?.active_character_id)
  const newChat = useChatStore((s) => s.newChat)
  const generatingFor = useAvatarStore((s) => s.generatingFor)

  const [editing, setEditing] = useState<Character | null | 'new'>(null)

  if (editing !== null) {
    return (
      <CharacterStudio
        character={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    )
  }

  const startChat = async (character: Character) => {
    await newChat(character.id)
    onStartChat()
  }

  return (
    <div className="flex h-full w-full flex-col bg-app">
      <header className="titlebar-drag flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4 sm:px-6">
        <div className="titlebar-no-drag flex items-center gap-2.5 pl-16 sm:pl-0">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to chat">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-medium text-white">Characters</h2>
        </div>
        <div className="titlebar-no-drag">
          <Button variant="accent" size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" /> New character
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {characters.map((character) => {
            const active = character.id === activeId
            const busy = generatingFor === character.id
            return (
              <div
                key={character.id}
                className={cn(
                  'group relative flex flex-col items-center rounded-2xl border p-4 text-center transition',
                  active
                    ? 'border-accent/40 bg-accent-soft'
                    : 'border-border bg-card/40 hover:bg-card',
                )}
              >
                <div className="relative">
                  <Avatar character={character} size="xl" ring={active} />
                  {busy && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                </div>

                <p className="mt-3 w-full truncate text-sm font-medium text-white">
                  {character.name}
                </p>
                <p className="mt-0.5 line-clamp-2 min-h-[2rem] text-xs text-muted">
                  {character.description || 'No description'}
                </p>

                {active && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    <Check className="h-2.5 w-2.5" /> Active
                  </span>
                )}

                <div className="mt-3 flex w-full gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => void startChat(character)}
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Chat
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(character)}
                    aria-label={`Edit ${character.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${character.name}`}
                    onClick={() => {
                      if (
                        confirm(
                          `Delete ${character.name}? Everything they remember about you goes too.`,
                        )
                      ) {
                        void remove(character.id)
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {!active && (
                  <button
                    onClick={() => void setActive(character.id)}
                    className="mt-1.5 text-[11px] text-muted transition hover:text-accent"
                  >
                    Make default
                  </button>
                )}
              </div>
            )
          })}

          <button
            onClick={() => setEditing('new')}
            className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted transition hover:border-accent/40 hover:text-accent"
          >
            <Plus className="h-6 w-6" />
            <span className="text-sm">New character</span>
          </button>
        </div>
      </div>
    </div>
  )
}
