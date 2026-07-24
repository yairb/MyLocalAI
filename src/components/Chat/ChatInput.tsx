import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useEngineStore } from '@/stores/engineStore'
import { cn } from '@/utils/cn'

export function ChatInput() {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopGenerating = useChatStore((s) => s.stopGenerating)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const inputFocusToken = useChatStore((s) => s.inputFocusToken)
  const error = useChatStore((s) => s.error)
  const clearError = useChatStore((s) => s.clearError)
  const engineStatus = useEngineStore((s) => s.status)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [inputFocusToken])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const canSend =
    value.trim().length > 0 &&
    !isGenerating &&
    (engineStatus === 'ready' || engineStatus === 'idle' || engineStatus === 'no_model')

  const submit = async () => {
    if (!value.trim() || isGenerating) return
    const content = value
    setValue('')
    clearError()
    await sendMessage(content)
    textareaRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  return (
    <div className="shrink-0 border-t border-border-subtle bg-app/80 px-4 pb-5 pt-3 backdrop-blur-md sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {error && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-danger-soft px-3.5 py-2.5 text-sm text-red-300 animate-fade-in">
            <p className="min-w-0 flex-1">{error}</p>
            <button
              onClick={clearError}
              className="shrink-0 text-xs text-red-200/80 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className={cn(
            'relative flex items-end gap-2 rounded-3xl border border-border bg-input px-3 py-2.5 shadow-lg shadow-black/20',
            'transition-colors focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/15',
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message your AI…"
            rows={1}
            className="chat-textarea max-h-[200px] min-h-[28px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-white outline-none placeholder:text-muted-dim"
          />

          {isGenerating ? (
            <button
              type="button"
              onClick={stopGenerating}
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-neutral-200"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className={cn(
                'mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
                canSend
                  ? 'bg-white text-black hover:bg-neutral-200'
                  : 'bg-card text-muted-dim cursor-not-allowed',
              )}
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </form>

        <p className="mt-2.5 text-center text-[11px] text-muted-dim">
          Local model · responses stay on your Mac · Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
