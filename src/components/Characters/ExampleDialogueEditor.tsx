import { Plus, Trash2 } from 'lucide-react'
import type { ExampleExchange } from '@/types'
import { Button } from '@/components/UI/Button'
import { TextArea } from '@/components/UI/Input'

/**
 * Style samples. These go into the prompt as labelled samples rather than as seeded
 * history, so the character never mistakes them for things that actually happened.
 */
export function ExampleDialogueEditor({
  value,
  onChange,
  characterName,
}: {
  value: ExampleExchange[]
  onChange: (next: ExampleExchange[]) => void
  characterName: string
}) {
  const update = (index: number, patch: Partial<ExampleExchange>) => {
    onChange(value.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  return (
    <div className="flex flex-col gap-3">
      {value.map((exchange, index) => (
        <div
          key={index}
          className="rounded-xl border border-border bg-card/40 p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Sample {index + 1}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="text-muted transition hover:text-danger"
              aria-label="Remove sample"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <TextArea
            value={exchange.user}
            onChange={(e) => update(index, { user: e.target.value })}
            placeholder="What you might say…"
            className="mb-2 min-h-[52px] text-[13px]"
          />
          <TextArea
            value={exchange.character}
            onChange={(e) => update(index, { character: e.target.value })}
            placeholder={`How ${characterName || 'they'} would answer…`}
            className="min-h-[72px] text-[13px]"
          />
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...value, { user: '', character: '' }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add sample
      </Button>
    </div>
  )
}
