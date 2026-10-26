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
  ImageIcon,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEngineStore } from '@/stores/engineStore'
import {
  getImageModelCompatibilityWarning,
  isLikelyCheckpointFilePath,
} from '@/services/imageGeneration'
import { Button } from '@/components/UI/Button'
import { Input, Label, RangeField, TextArea } from '@/components/UI/Input'
import { CharacterEditor } from './CharacterEditor'
import type {
  ImageBackend,
  ImageFormat,
  ImageResolution,
  ImageSampler,
} from '@/types'
import { cn } from '@/utils/cn'

type Tab = 'model' | 'generation' | 'image' | 'characters' | 'appearance'

interface SettingsPageProps {
  onBack: () => void
  onOpenCharacters?: () => void
}

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: 'model', label: 'Model', icon: HardDrive },
  { id: 'generation', label: 'Generation', icon: SlidersHorizontal },
  { id: 'image', label: 'Images', icon: ImageIcon },
  { id: 'characters', label: 'Characters', icon: Bot },
  { id: 'appearance', label: 'Appearance', icon: Palette },
]

const RESOLUTIONS: ImageResolution[] = ['512x512', '768x768', '1024x1024']
const SAMPLERS: ImageSampler[] = [
  'euler_a',
  'euler',
  'heun',
  'dpm2',
  'dpm++2m',
  'dpm++2s_a',
  'lms',
  'ddim',
]
const FORMATS: ImageFormat[] = ['png', 'jpeg']
const IMAGE_BACKENDS: { value: ImageBackend; label: string; hint: string }[] = [
  {
    value: 'mlx',
    label: 'MLX (Apple Silicon)',
    hint: 'Uses Python + MLX runtime on macOS',
  },
  {
    value: 'sdcpp',
    label: 'stable-diffusion.cpp',
    hint: 'Uses sd-cli / sd executable',
  },
]

export function SettingsPage({ onBack, onOpenCharacters }: SettingsPageProps) {
  const [tab, setTab] = useState<Tab>('model')
  const settings = useSettingsStore((s) => s.settings)
  const modelsDir = useSettingsStore((s) => s.modelsDir)
  const localModels = useSettingsStore((s) => s.localModels)
  const imageModelsDir = useSettingsStore((s) => s.imageModelsDir)
  const localImageModels = useSettingsStore((s) => s.localImageModels)
  const update = useSettingsStore((s) => s.update)
  const pickModel = useSettingsStore((s) => s.pickModel)
  const refreshModels = useSettingsStore((s) => s.refreshModels)
  const pickImageModel = useSettingsStore((s) => s.pickImageModel)
  const refreshImageModels = useSettingsStore((s) => s.refreshImageModels)
  const engine = useEngineStore()
  const imageBackend = settings?.image_backend ?? 'mlx'
  const imageModelWarning = getImageModelCompatibilityWarning(
    imageBackend,
    settings?.image_model_path,
  )
  const filteredLocalImageModels =
    imageBackend === 'mlx'
      ? localImageModels.filter((name) => !isLikelyCheckpointFilePath(name))
      : localImageModels
  const hiddenCheckpointCount = localImageModels.length - filteredLocalImageModels.length

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

            {tab === 'image' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">Image Generation</h2>
                  <p className="mt-1 text-sm text-muted">
                    The image backend is swappable without changing the chat UI.
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-card/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-dim">
                        Image model
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {settings.image_model_name ??
                          settings.image_model_path?.split('/').pop() ??
                          'None selected'}
                      </p>
                      {settings.image_model_path && (
                        <p className="mt-1 break-all text-xs text-muted-dim">
                          {settings.image_model_path}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium',
                        settings.image_model_path
                          ? 'bg-accent-soft text-accent'
                          : 'bg-card text-muted',
                      )}
                    >
                      {settings.image_model_path ? 'Configured' : 'Missing'}
                    </span>
                  </div>

                  {imageModelWarning && (
                    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      {imageModelWarning}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={() => void pickImageModel()}
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Browse model
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void refreshImageModels()}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>Image model location</Label>
                  <Input
                    value={imageModelsDir}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <p className="mt-1.5 text-xs text-muted-dim">
                    {imageBackend === 'mlx'
                      ? 'For MLX, set a Hugging Face SDXL repo id, e.g. RunDiffusion/Juggernaut-XL-v9.'
                      : 'For stable-diffusion.cpp, place .safetensors files here, e.g. stable-diffusion-v1-5.safetensors.'}
                  </p>
                </div>

                <div>
                  <Label>Image model path or repo id</Label>
                  <Input
                    value={settings.image_model_path ?? ''}
                    placeholder={
                      imageBackend === 'mlx'
                        ? 'RunDiffusion/Juggernaut-XL-v9'
                        : '/absolute/path/to/model.safetensors'
                    }
                    onChange={(e) => {
                      const path = e.target.value.trim()
                      const name = path ? path.split('/').filter(Boolean).pop() ?? path : null
                      void update({
                        image_model_path: path || null,
                        image_model_name: name,
                      })
                    }}
                    className="font-mono text-xs"
                  />
                  <p className="mt-1.5 text-xs text-muted-dim">
                    {imageBackend === 'mlx'
                      ? 'Supported: built-ins (sdxl, sd) and SDXL-style Hugging Face repos like RunDiffusion/Juggernaut-XL-v9.'
                      : 'You can paste any absolute model file path.'}
                  </p>
                </div>

                {filteredLocalImageModels.length > 0 && (
                  <div>
                    <Label>Available image models</Label>
                    <div className="mt-1 flex flex-col gap-1.5">
                      {filteredLocalImageModels.map((name) => (
                        <button
                          key={name}
                          onClick={() =>
                            void update({
                              image_model_name: name,
                              image_model_path: `${imageModelsDir}/${name}`,
                            })
                          }
                          className={cn(
                            'rounded-xl border px-3 py-2.5 text-left text-sm transition',
                            settings.image_model_name === name
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

                {imageBackend === 'mlx' && hiddenCheckpointCount > 0 && (
                  <p className="text-xs text-muted-dim">
                    Hidden {hiddenCheckpointCount} checkpoint file
                    {hiddenCheckpointCount > 1 ? 's' : ''} because MLX requires a model directory.
                  </p>
                )}

                <div className="space-y-5 rounded-2xl border border-border bg-card/40 p-5">
                  <div>
                    <Label>Image backend</Label>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      {IMAGE_BACKENDS.map((backend) => {
                        const selected =
                          (settings.image_backend ?? 'mlx') === backend.value
                        return (
                          <button
                            key={backend.value}
                            onClick={() =>
                              void update({ image_backend: backend.value })
                            }
                            className={cn(
                              'rounded-xl border px-3 py-2.5 text-left text-sm transition',
                              selected
                                ? 'border-accent/40 bg-accent-soft text-white'
                                : 'border-border bg-card/40 text-muted hover:bg-card',
                            )}
                          >
                            <p className="font-medium">{backend.label}</p>
                            <p className="mt-0.5 text-xs text-muted-dim">
                              {backend.hint}
                            </p>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <Label>Default resolution</Label>
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      {RESOLUTIONS.map((res) => (
                        <button
                          key={res}
                          onClick={() => void update({ image_resolution: res })}
                          className={cn(
                            'rounded-xl border px-3 py-2.5 text-sm transition',
                            settings.image_resolution === res
                              ? 'border-accent/40 bg-accent-soft text-white'
                              : 'border-border bg-card/40 text-muted hover:bg-card',
                          )}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>

                  <RangeField
                    label="Inference steps"
                    value={settings.image_steps}
                    min={5}
                    max={50}
                    step={1}
                    onChange={(image_steps) => void update({ image_steps })}
                  />

                  <RangeField
                    label="CFG scale"
                    value={settings.image_cfg_scale}
                    min={1}
                    max={20}
                    step={0.5}
                    onChange={(image_cfg_scale) =>
                      void update({ image_cfg_scale })
                    }
                    display={settings.image_cfg_scale.toFixed(1)}
                  />

                  <div>
                    <Label>Sampler</Label>
                    <select
                      value={settings.image_sampler}
                      onChange={(e) =>
                        void update({
                          image_sampler: e.target.value as ImageSampler,
                        })
                      }
                      className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                    >
                      {SAMPLERS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Seed</Label>
                      <Input
                        type="number"
                        value={settings.image_seed}
                        disabled={settings.image_random_seed}
                        onChange={(e) =>
                          void update({
                            image_seed: Number(e.target.value) || -1,
                          })
                        }
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted">
                        <input
                          type="checkbox"
                          checked={settings.image_random_seed}
                          onChange={(e) =>
                            void update({ image_random_seed: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-border accent-accent"
                        />
                        Random seed
                      </label>
                    </div>
                  </div>

                  <div>
                    <Label>Default image format</Label>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {FORMATS.map((fmt) => (
                        <button
                          key={fmt}
                          onClick={() => void update({ image_format: fmt })}
                          className={cn(
                            'rounded-xl border px-3 py-2.5 text-sm uppercase transition',
                            settings.image_format === fmt
                              ? 'border-accent/40 bg-accent-soft text-white'
                              : 'border-border bg-card/40 text-muted hover:bg-card',
                          )}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={settings.image_enhance_prompt}
                      onChange={(e) =>
                        void update({ image_enhance_prompt: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                    Enhance prompt with LLM by default
                  </label>

                  <div>
                    <Label>Negative prompt</Label>
                    <Input
                      value={settings.image_negative_prompt}
                      onChange={(e) =>
                        void update({ image_negative_prompt: e.target.value })
                      }
                    />
                  </div>

                  <div>
                    <Label>Backend executable or config path (optional)</Label>
                    <Input
                      value={settings.image_binary_path ?? ''}
                      placeholder={
                        imageBackend === 'mlx'
                          ? '/path/to/python3 or /path/to/mlx-examples/stable_diffusion'
                          : '/path/to/sd-cli'
                      }
                      onChange={(e) =>
                        void update({
                          image_binary_path: e.target.value || null,
                        })
                      }
                      className="font-mono text-xs"
                    />
                    <p className="mt-1.5 text-xs text-muted-dim">
                      {imageBackend === 'mlx'
                        ? 'Leave empty to auto-detect python3 and ~/git/mlx-examples/stable_diffusion'
                        : 'Leave empty to auto-detect sd on PATH'}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {tab === 'characters' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">Characters</h2>
                  <p className="mt-1 text-sm text-muted">
                    Who you talk to, and what they are allowed to do.
                  </p>
                </div>

                <div className="space-y-5 rounded-2xl border border-border bg-card/40 p-5">
                  <p className="text-sm font-medium text-white">About you</p>
                  <div>
                    <Label>Your name</Label>
                    <Input
                      value={settings.user_name}
                      onChange={(e) => void update({ user_name: e.target.value })}
                      placeholder="What your characters call you"
                    />
                  </div>
                  <div>
                    <Label>About you</Label>
                    <TextArea
                      value={settings.user_persona}
                      onChange={(e) => void update({ user_persona: e.target.value })}
                      placeholder="Anything every character should know from the start."
                      className="min-h-[80px]"
                    />
                  </div>
                </div>

                <div className="space-y-5 rounded-2xl border border-border bg-card/40 p-5">
                  <p className="text-sm font-medium text-white">Memory</p>
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.memory_enabled}
                      onChange={(e) =>
                        void update({ memory_enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                    Let characters remember things between conversations
                  </label>
                  <RangeField
                    label="Things to remember per character"
                    value={settings.memory_max_facts}
                    min={20}
                    max={500}
                    step={10}
                    onChange={(memory_max_facts) => void update({ memory_max_facts })}
                    display={String(settings.memory_max_facts)}
                  />
                </div>

                <div className="space-y-5 rounded-2xl border border-border bg-card/40 p-5">
                  <div>
                    <p className="text-sm font-medium text-white">Photos in chat</p>
                    <p className="mt-1 text-xs text-muted">
                      Sending a photo stops the chat model to free the GPU and then
                      reloads it, so these limits keep a conversation moving.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.auto_image_enabled}
                      onChange={(e) =>
                        void update({ auto_image_enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                    Let characters send photos of themselves
                  </label>
                  <RangeField
                    label="Most photos per conversation"
                    value={settings.auto_image_max_per_conversation}
                    min={0}
                    max={50}
                    step={1}
                    onChange={(auto_image_max_per_conversation) =>
                      void update({ auto_image_max_per_conversation })
                    }
                    display={String(settings.auto_image_max_per_conversation)}
                  />
                  <RangeField
                    label="Replies between photos"
                    value={settings.auto_image_cooldown_turns}
                    min={0}
                    max={10}
                    step={1}
                    onChange={(auto_image_cooldown_turns) =>
                      void update({ auto_image_cooldown_turns })
                    }
                    display={String(settings.auto_image_cooldown_turns)}
                  />
                  <div>
                    <Label>Photo style</Label>
                    <Input
                      value={settings.image_style_suffix}
                      onChange={(e) =>
                        void update({ image_style_suffix: e.target.value })
                      }
                      placeholder="Appended to every photo a character sends"
                    />
                  </div>
                </div>

                <CharacterEditor onOpenCharacters={onOpenCharacters} />
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
