import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from 'react'
import {
  ArrowUp,
  ImageIcon,
  Settings,
  Sparkles,
  Square,
  Wand2,
} from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useEngineStore } from '@/stores/engineStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/utils/cn'

interface ChatInputProps {
  onOpenSettings?: () => void
}

export function ChatInput({ onOpenSettings }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopGenerating = useChatStore((s) => s.stopGenerating)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const isGeneratingImage = useChatStore((s) => s.isGeneratingImage)
  const cancelImageGeneration = useChatStore((s) => s.cancelImageGeneration)
  const inputFocusToken = useChatStore((s) => s.inputFocusToken)
  const error = useChatStore((s) => s.error)
  const clearError = useChatStore((s) => s.clearError)
  const imageMode = useChatStore((s) => s.imageMode)
  const setImageMode = useChatStore((s) => s.setImageMode)
  const enhancePrompt = useChatStore((s) => s.enhancePrompt)
  const setEnhancePrompt = useChatStore((s) => s.setEnhancePrompt)
  const engineStatus = useEngineStore((s) => s.status)
  const imageModelPath = useSettingsStore((s) => s.settings?.image_model_path)
  const settingsEnhance = useSettingsStore(
    (s) => s.settings?.image_enhance_prompt,
  )

  // Sync enhance default from settings once loaded (local state only)
  useEffect(() => {
    if (typeof settingsEnhance === 'boolean') {
      useChatStore.setState({ enhancePrompt: settingsEnhance })
    }
  }, [settingsEnhance])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [inputFocusToken])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const busy = isGenerating || (imageMode && isGeneratingImage)
  const canSend =
    value.trim().length > 0 &&
    !busy &&
    (imageMode
      ? true
      : engineStatus === 'ready' ||
        engineStatus === 'idle' ||
        engineStatus === 'no_model')

  const submit = async () => {
    if (!value.trim() || busy) return
    if (imageMode && isGeneratingImage) return
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

  const missingImageModel =
    error === 'No Stable Diffusion model configured.' ||
    error?.includes('No Stable Diffusion model')

  return (
    <div className="shrink-0 border-t border-border-subtle bg-app/80 px-4 pb-5 pt-3 backdrop-blur-md sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {error && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-danger-soft px-3.5 py-2.5 text-sm text-red-300 animate-fade-in">
            <p className="min-w-0 flex-1">{error}</p>
            <div className="flex shrink-0 items-center gap-2">
              {missingImageModel && onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/15"
                >
                  <Settings className="h-3 w-3" /> Open Settings
                </button>
              )}
              <button
                onClick={clearError}
                className="text-xs text-red-200/80 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {imageMode && (
          <div className="mb-2 flex flex-wrap items-center gap-3 px-1 animate-fade-in">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
              <ImageIcon className="h-3 w-3" />
              Image mode
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={enhancePrompt}
                onChange={(e) => setEnhancePrompt(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
              <Sparkles className="h-3 w-3 text-accent" />
              Enhance Prompt
            </label>
            {!imageModelPath && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-xs text-amber-400/90 hover:text-amber-300"
              >
                No model configured — open Settings
              </button>
            )}
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className={cn(
            'relative flex items-end gap-2 rounded-3xl border bg-input px-3 py-2.5 shadow-lg shadow-black/20',
            'transition-colors focus-within:ring-2',
            imageMode
              ? 'border-accent/40 focus-within:border-accent/50 focus-within:ring-accent/15'
              : 'border-border focus-within:border-accent/40 focus-within:ring-accent/15',
          )}
        >
          <button
            type="button"
            onClick={() => setImageMode(!imageMode)}
            disabled={isGeneratingImage}
            className={cn(
              'mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
              imageMode
                ? 'bg-accent text-white shadow-md shadow-accent/20'
                : 'bg-card text-muted hover:bg-card-hover hover:text-white',
              isGeneratingImage && 'cursor-not-allowed opacity-50',
            )}
            aria-label={imageMode ? 'Disable image mode' : 'Generate image'}
            title={
              imageMode
                ? 'Image mode on — click to switch back to chat'
                : 'Generate image'
            }
          >
            <Wand2 className="h-4 w-4" />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              imageMode
                ? 'Describe an image… e.g. a futuristic Tokyo skyline'
                : 'Message your AI…'
            }
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
          ) : isGeneratingImage && imageMode ? (
            <button
              type="button"
              onClick={cancelImageGeneration}
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-neutral-200"
              aria-label="Cancel image generation"
              title="Cancel image generation"
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
                  ? imageMode
                    ? 'bg-accent text-white hover:bg-accent-hover'
                    : 'bg-white text-black hover:bg-neutral-200'
                  : 'bg-card text-muted-dim cursor-not-allowed',
              )}
              aria-label={imageMode ? 'Generate image' : 'Send message'}
            >
              {imageMode ? (
                <ImageIcon className="h-4 w-4" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          )}
        </form>

        <p className="mt-2.5 text-center text-[11px] text-muted-dim">
          {imageMode
            ? 'Image generation runs locally · text chat still works when image mode is off'
            : 'Local model · responses stay on your Mac · Enter to send · Shift+Enter for newline'}
        </p>
      </div>
    </div>
  )
}
