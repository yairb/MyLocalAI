import { useEffect, useState } from 'react'
import { Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import type { Character } from '@/types'
import { useMemoryStore } from '@/stores/memoryStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Button } from '@/components/UI/Button'
import { Input, Label, TextArea } from '@/components/UI/Input'
import { cn } from '@/utils/cn'

/** What the character has picked up, and the user's chance to correct it. */
export function MemoryPanel({ character }: { character: Character }) {
  const memories = useMemoryStore((s) => s.memories)
  const summary = useMemoryStore((s) => s.summary)
  const load = useMemoryStore((s) => s.load)
  const add = useMemoryStore((s) => s.add)
  const edit = useMemoryStore((s) => s.edit)
  const togglePin = useMemoryStore((s) => s.togglePin)
  const remove = useMemoryStore((s) => s.remove)
  const forgetAll = useMemoryStore((s) => s.forgetAll)
  const clearSummary = useMemoryStore((s) => s.clearSummary)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const maxFacts = useSettingsStore((s) => s.settings?.memory_max_facts ?? 200)

  const [draft, setDraft] = useState('')

  useEffect(() => {
    void load(character.id, activeConversationId)
  }, [character.id, activeConversationId, load])

  const pinnedCount = memories.filter((m) => m.pinned).length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>The story so far</Label>
        <TextArea
          value={summary?.summary ?? ''}
          readOnly
          placeholder="Nothing yet. This fills in on its own once the conversation gets long enough."
          className="min-h-[120px] text-[13px] text-muted"
        />
        {activeConversationId && summary && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => void clearSummary(activeConversationId)}
          >
            Clear summary
          </Button>
        )}
      </div>

      <div>
        <Label>Add something they should always know</Label>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void add(character.id, draft)
                setDraft('')
              }
            }}
            placeholder="e.g. I have a dog called Pepper"
          />
          <Button
            variant="secondary"
            onClick={() => {
              void add(character.id, draft)
              setDraft('')
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Pin
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label className="mb-0">What they remember</Label>
          <span className="text-[11px] text-muted">
            {memories.length} of {maxFacts} · {pinnedCount} pinned
          </span>
        </div>

        {memories.length === 0 ? (
          <p className="rounded-xl border border-border bg-card/40 px-3.5 py-3 text-xs text-muted">
            Nothing remembered yet. Facts are picked up automatically as you talk.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {memories.map((memory) => (
              <div
                key={memory.id}
                className={cn(
                  'group flex items-start gap-2 rounded-xl border px-3 py-2',
                  memory.pinned
                    ? 'border-accent/30 bg-accent-soft'
                    : 'border-border bg-card/40',
                )}
              >
                <span className="mt-0.5 shrink-0 rounded-full bg-card px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted">
                  {memory.kind}
                </span>
                <input
                  value={memory.content}
                  onChange={(e) => void edit(memory.id, e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none"
                />
                <button
                  onClick={() => void togglePin(memory.id)}
                  className="text-muted transition hover:text-accent"
                  aria-label={memory.pinned ? 'Unpin' : 'Pin'}
                >
                  {memory.pinned ? (
                    <PinOff className="h-3.5 w-3.5" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  onClick={() => void remove(memory.id)}
                  className="text-muted transition hover:text-danger"
                  aria-label="Forget this"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {memories.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            className="mt-3"
            onClick={() => {
              if (!confirm(`Forget everything ${character.name} knows about you?`)) return
              if (!confirm('This cannot be undone. Really forget everything?')) return
              void forgetAll(character.id)
            }}
          >
            Forget everything
          </Button>
        )}
      </div>
    </div>
  )
}
