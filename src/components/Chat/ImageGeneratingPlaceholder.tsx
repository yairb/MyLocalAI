import { ImageIcon, Loader2, RefreshCw, Settings, X } from 'lucide-react'
import type { ImageGenerationJob } from '@/types'
import { Button } from '@/components/UI/Button'
import { cn } from '@/utils/cn'

interface ImageGeneratingPlaceholderProps {
  job: ImageGenerationJob
  onCancel?: () => void
  onRetry?: () => void
  onOpenSettings?: () => void
}

export function ImageGeneratingPlaceholder({
  job,
  onCancel,
  onRetry,
  onOpenSettings,
}: ImageGeneratingPlaceholderProps) {
  const isError = job.status === 'error'
  const isEnhancing = job.status === 'enhancing'
  const progress = Math.min(100, Math.max(0, job.progress))
  const filled = Math.round(progress / 5)
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)

  const elapsed = Math.round((Date.now() - job.started_at) / 1000)
  const fallbackRemaining = job.estimated_seconds
    ? Math.max(0, job.estimated_seconds - elapsed)
    : null
  const dynamicRemaining =
    progress > 1
      ? Math.max(0, Math.round((elapsed * (100 - progress)) / progress))
      : null
  const remaining = dynamicRemaining ?? fallbackRemaining

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="flex max-w-[90%] items-start gap-3 sm:max-w-[80%]">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft border border-accent/20">
          <ImageIcon className="h-3.5 w-3.5 text-accent" />
        </div>

        <div
          className={cn(
            'min-w-[280px] max-w-md overflow-hidden rounded-2xl border bg-card/60 shadow-lg shadow-black/20',
            isError ? 'border-red-500/30' : 'border-border',
          )}
        >
          {/* Skeleton / progress area */}
          <div className="relative aspect-square w-full overflow-hidden bg-[#141414]">
            {!isError && (
              <div className="absolute inset-0 image-skeleton" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
              {isError ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
                    <X className="h-5 w-5 text-danger" />
                  </div>
                  <p className="text-center text-sm text-red-300">
                    {job.error ?? 'Generation failed'}
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-accent" />
                  <p className="text-sm font-medium text-white">
                    {isEnhancing
                      ? 'Enhancing prompt…'
                      : 'Generating image…'}
                  </p>
                  {!isEnhancing && (
                    <p className="font-mono text-xs tracking-wider text-muted">
                      {bar}
                    </p>
                  )}
                  <p className="text-xs text-muted-dim">
                    {isEnhancing
                      ? 'Using local LLM'
                      : remaining !== null
                        ? `~${remaining}s remaining · ${Math.round(progress)}%`
                        : `${Math.round(progress)}%`}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="space-y-2 border-t border-border-subtle px-4 py-3">
            <p className="line-clamp-2 text-sm text-muted">
              <span className="text-muted-dim">Prompt: </span>
              {job.enhanced_prompt ?? job.original_prompt}
            </p>

            <div className="flex flex-wrap gap-2">
              {isError ? (
                <>
                  <Button variant="accent" size="sm" onClick={onRetry}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                  {(job.error?.includes('model') ||
                    job.error?.includes('configured') ||
                    job.error?.includes('binary')) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onOpenSettings}
                    >
                      <Settings className="h-3.5 w-3.5" /> Open Settings
                    </Button>
                  )}
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
