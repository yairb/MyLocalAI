import { useState } from 'react'
import { Loader2, Sparkles, Wand2 } from 'lucide-react'
import type { CharacterDraft } from '@/types'
import {
  writeField,
  type WritableField,
  type WriteMode,
} from '@/services/characterWriter'
import { useEngineStore } from '@/stores/engineStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/utils/cn'

/**
 * Writes a character field with the local model, or sharpens what is already there.
 *
 * The mode is implicit: an empty field gets written from scratch, a filled one gets
 * rewritten in place. Making the user choose would be a menu for a decision the
 * content already answers.
 */
export function AiFieldButton({
  field,
  draft,
  hasContent,
  onResult,
  label,
}: {
  field: WritableField
  draft: CharacterDraft
  hasContent: boolean
  onResult: (text: string) => void
  /** Overrides the tooltip, for fields whose name doesn't read well in one. */
  label?: string
}) {
  const engineStatus = useEngineStore((s) => s.status)
  const host = useSettingsStore((s) => s.settings?.llama_host ?? '127.0.0.1')
  const port = useSettingsStore((s) => s.settings?.llama_port ?? 8080)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mode: WriteMode = hasContent ? 'enhance' : 'generate'
  const ready = engineStatus === 'ready'
  const what = label ?? 'this'

  const run = async () => {
    if (busy || !ready) return
    setBusy(true)
    setError(null)
    try {
      onResult(await writeField(field, draft, mode, { host, port }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span className="text-[11px] text-danger" title={error}>
          {error.length > 42 ? 'Failed' : error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !ready}
        title={
          !ready
            ? 'Needs the chat model running'
            : mode === 'enhance'
              ? `Rewrite ${what} with the model`
              : `Write ${what} with the model`
        }
        className={cn(
          'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition',
          ready && !busy
            ? 'text-muted hover:bg-card hover:text-accent'
            : 'cursor-not-allowed text-muted-dim opacity-60',
        )}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : mode === 'enhance' ? (
          <Wand2 className="h-3 w-3" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {busy ? 'Writing…' : mode === 'enhance' ? 'Improve' : 'Write it'}
      </button>
    </span>
  )
}
