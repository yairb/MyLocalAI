import { Sparkles } from 'lucide-react'
import { useEngineStore } from '@/stores/engineStore'
import { Button } from '@/components/UI/Button'
import { useSettingsStore } from '@/stores/settingsStore'

interface LoadingScreenProps {
  onOpenSettings: () => void
  onContinue: () => void
}

export function LoadingScreen({ onOpenSettings, onContinue }: LoadingScreenProps) {
  const { status, message, progress, error } = useEngineStore()
  const settings = useSettingsStore((s) => s.settings)
  const start = useEngineStore((s) => s.start)

  const canContinue =
    status === 'ready' || status === 'no_model' || status === 'error' || status === 'idle'

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-app px-6 animate-fade-in-soft">
      <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl border border-border bg-card shadow-2xl shadow-black/40">
        <Sparkles className="h-9 w-9 text-accent" strokeWidth={1.5} />
      </div>

      <h1 className="mb-2 text-2xl font-semibold tracking-tight">My Local AI</h1>
      <p className="mb-10 text-sm text-muted">Private. Local. Yours.</p>

      <div className="w-full max-w-sm">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-muted">{message || 'Starting AI engine…'}</span>
          <span className="tabular-nums text-muted-dim">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-card">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>

        {settings?.model_name && (
          <p className="mt-4 text-center text-xs text-muted-dim">
            Model: {settings.model_name}
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/20 bg-danger-soft px-3 py-2 text-center text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-8 flex flex-col gap-2">
          {status === 'ready' && (
            <Button variant="accent" size="lg" className="w-full" onClick={onContinue}>
              Ready — Start chatting
            </Button>
          )}

          {(status === 'no_model' || status === 'error') && (
            <>
              <Button variant="accent" size="lg" className="w-full" onClick={onOpenSettings}>
                {status === 'no_model' ? 'Select a model' : 'Open settings'}
              </Button>
              <Button variant="ghost" size="md" className="w-full" onClick={onContinue}>
                Continue without engine
              </Button>
              {status === 'error' && (
                <Button variant="secondary" size="md" className="w-full" onClick={() => void start()}>
                  Retry
                </Button>
              )}
            </>
          )}

          {!canContinue && (
            <p className="text-center text-xs text-muted-dim">
              Loading model into memory (Metal)…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
