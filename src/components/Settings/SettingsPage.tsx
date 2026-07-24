import { useState } from 'react'
import {
  ArrowLeft,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Cpu,
  Palette,
  Bot,
  SlidersHorizontal,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEngineStore } from '@/stores/engineStore'
import { Button } from '@/components/UI/Button'
import { Input, Label, RangeField } from '@/components/UI/Input'
import { CharacterEditor } from './CharacterEditor'
import { cn } from '@/utils/cn'

type Tab = 'model' | 'generation' | 'characters' | 'appearance'

interface SettingsPageProps {
  onBack: () => void
}

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: 'model', label: 'Model', icon: HardDrive },
  { id: 'generation', label: 'Generation', icon: SlidersHorizontal },
  { id: 'characters', label: 'Characters', icon: Bot },
  { id: 'appearance', label: 'Appearance', icon: Palette },
]

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [tab, setTab] = useState<Tab>('model')
  const settings = useSettingsStore((s) => s.settings)
  const modelsDir = useSettingsStore((s) => s.modelsDir)
  const localModels = useSettingsStore((s) => s.localModels)
  const update = useSettingsStore((s) => s.update)
  const pickModel = useSettingsStore((s) => s.pickModel)
  const refreshModels = useSettingsStore((s) => s.refreshModels)
  const engine = useEngineStore()

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading settings…
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app animate-fade-in-soft">
      <header className="titlebar-drag flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
        <button
          onClick={onBack}
          className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-card hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="titlebar-no-drag text-sm font-semibold">Settings</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-48 shrink-0 flex-col gap-1 border-r border-border-subtle p-3 sm:flex">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition',
                tab === id
                  ? 'bg-card text-white'
                  : 'text-muted hover:bg-card/60 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5 sm:p-8">
          <div className="mb-5 flex gap-2 overflow-x-auto sm:hidden">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium',
                  tab === id
                    ? 'bg-white text-black'
                    : 'bg-card text-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mx-auto max-w-2xl">
            {tab === 'model' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">Model</h2>
                  <p className="mt-1 text-sm text-muted">
                    GGUF models live outside the app bundle for easy switching.
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-card/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-dim">
                        Current model
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {settings.model_name ?? 'None selected'}
                      </p>
                      {settings.model_path && (
                        <p className="mt-1 break-all text-xs text-muted-dim">
                          {settings.model_path}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium',
                        engine.status === 'ready'
                          ? 'bg-accent-soft text-accent'
                          : 'bg-card text-muted',
                      )}
                    >
                      {engine.status === 'ready' ? 'Loaded' : engine.status}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="accent" size="sm" onClick={() => void pickModel()}>
                      <FolderOpen className="h-3.5 w-3.5" /> Select model file
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void engine.start()}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Restart engine
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>Model location</Label>
                  <div className="flex gap-2">
                    <Input value={modelsDir} readOnly className="font-mono text-xs" />
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => void refreshModels()}
                      title="Refresh model list"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-dim">
                    Place GGUF files here, e.g. MythoMax-L2-13B-Q4_K_M.gguf
                  </p>
                </div>

                {localModels.length > 0 && (
                  <div>
                    <Label>Available models</Label>
                    <div className="mt-1 flex flex-col gap-1.5">
                      {localModels.map((name) => (
                        <button
                          key={name}
                          onClick={() =>
                            void update({
                              model_name: name,
                              model_path: `${modelsDir}/${name}`,
                            })
                          }
                          className={cn(
                            'rounded-xl border px-3 py-2.5 text-left text-sm transition',
                            settings.model_name === name
                              ? 'border-accent/40 bg-accent-soft'
                              : 'border-border bg-card/40 hover:bg-card',
                          )}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <Label>Context size</Label>
                    <Input
                      type="number"
                      min={512}
                      max={32768}
                      step={512}
                      value={settings.context_size}
                      onChange={(e) =>
                        void update({ context_size: Number(e.target.value) || 4096 })
                      }
                    />
                  </div>
                  <div>
                    <Label>GPU layers (Metal)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={99}
                      value={settings.gpu_layers}
                      onChange={(e) =>
                        void update({ gpu_layers: Number(e.target.value) || 0 })
                      }
                    />
                    <p className="mt-1 text-xs text-muted-dim">
                      99 = offload as many layers as possible to Apple Silicon GPU
                    </p>
                  </div>
                  <div>
                    <Label>llama-server host</Label>
                    <Input
                      value={settings.llama_host}
                      onChange={(e) => void update({ llama_host: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Port</Label>
                    <Input
                      type="number"
                      value={settings.llama_port}
                      onChange={(e) =>
                        void update({ llama_port: Number(e.target.value) || 8080 })
                      }
                    />
                  </div>
                </div>
              </section>
            )}

            {tab === 'generation' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">Generation</h2>
                  <p className="mt-1 text-sm text-muted">
                    Default sampling parameters (characters can override temperature).
                  </p>
                </div>
                <div className="space-y-6 rounded-2xl border border-border bg-card/40 p-5">
                  <RangeField
                    label="Temperature"
                    value={settings.temperature}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(temperature) => void update({ temperature })}
                    display={settings.temperature.toFixed(2)}
                  />
                  <RangeField
                    label="Top P"
                    value={settings.top_p}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(top_p) => void update({ top_p })}
                    display={settings.top_p.toFixed(2)}
                  />
                  <div>
                    <Label>Max tokens</Label>
                    <Input
                      type="number"
                      min={64}
                      max={8192}
                      value={settings.max_tokens}
                      onChange={(e) =>
                        void update({ max_tokens: Number(e.target.value) || 2048 })
                      }
                    />
                  </div>
                </div>
              </section>
            )}

            {tab === 'characters' && (
              <section>
                <CharacterEditor />
              </section>
            )}

            {tab === 'appearance' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">Appearance</h2>
                  <p className="mt-1 text-sm text-muted">
                    Visual preferences for the desktop app.
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card/40 p-5">
                  <Label>Theme</Label>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-3 text-center text-sm">
                      Dark
                    </div>
                    <div className="rounded-xl border border-border bg-card/30 px-3 py-3 text-center text-sm text-muted-dim opacity-50">
                      Light
                      <span className="mt-1 block text-[10px]">Soon</span>
                    </div>
                    <div className="rounded-xl border border-border bg-card/30 px-3 py-3 text-center text-sm text-muted-dim opacity-50">
                      System
                      <span className="mt-1 block text-[10px]">Soon</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-card/40 p-5 text-sm text-muted">
                  <p className="font-medium text-white">Keyboard shortcuts</p>
                  <ul className="mt-3 space-y-2">
                    <li className="flex justify-between">
                      <span>New chat</span>
                      <kbd className="rounded border border-border px-2 py-0.5 text-xs">⌘ N</kbd>
                    </li>
                    <li className="flex justify-between">
                      <span>Search chats</span>
                      <kbd className="rounded border border-border px-2 py-0.5 text-xs">⌘ K</kbd>
                    </li>
                    <li className="flex justify-between">
                      <span>Settings</span>
                      <kbd className="rounded border border-border px-2 py-0.5 text-xs">⌘ ,</kbd>
                    </li>
                  </ul>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
