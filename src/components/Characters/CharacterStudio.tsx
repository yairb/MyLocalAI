import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Camera,
  Heart,
  Loader2,
  MessageSquare,
  Settings2,
  Sparkles,
  User,
} from 'lucide-react'
import type {
  Character,
  CharacterDraft,
  EmojiUsage,
  NarrationStyle,
  ResponseLength,
} from '@/types'
import { CHARACTER_DEFAULTS } from '@/services/database'
import {
  isListField,
  parseExampleExchange,
  type WritableField,
} from '@/services/characterWriter'
import {
  buildDepthNote,
  buildSystemPrompt,
  hasRichPersona,
} from '@/services/personaPrompt'
import { createEstimator } from '@/services/contextBudget'
import { useCharacterStore } from '@/stores/characterStore'
import { useEngineStore } from '@/stores/engineStore'
import { useAvatarStore } from '@/stores/avatarStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Avatar } from '@/components/UI/Avatar'
import { Button } from '@/components/UI/Button'
import { Input, Label, RangeField, TextArea } from '@/components/UI/Input'
import { cn } from '@/utils/cn'
import { AiFieldButton } from './AiFieldButton'
import { ExampleDialogueEditor } from './ExampleDialogueEditor'
import { MemoryPanel } from './MemoryPanel'
import { Segmented } from './Segmented'
import { TagInput } from './TagInput'

type Section =
  | 'basics'
  | 'story'
  | 'personality'
  | 'voice'
  | 'relationship'
  | 'appearance'
  | 'memory'
  | 'advanced'

const SECTIONS: { id: Section; label: string; icon: typeof User }[] = [
  { id: 'basics', label: 'Basics', icon: User },
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'personality', label: 'Personality', icon: Sparkles },
  { id: 'voice', label: 'Voice', icon: MessageSquare },
  { id: 'relationship', label: 'Relationship', icon: Heart },
  { id: 'appearance', label: 'Appearance', icon: Camera },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'advanced', label: 'Advanced', icon: Settings2 },
]

const LENGTHS: { value: ResponseLength; label: string }[] = [
  { value: 'terse', label: 'Terse' },
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
  { value: 'verbose', label: 'Verbose' },
]

const NARRATION: { value: NarrationStyle; label: string }[] = [
  { value: 'plain', label: 'Dialogue only' },
  { value: 'actions', label: 'With actions' },
  { value: 'story', label: 'Story' },
]

const NARRATION_HINT: Record<NarrationStyle, string> = {
  plain: 'Only what they say out loud. Best for assistants.',
  actions: 'Speech plain, with short *actions* in asterisks.',
  story:
    'Speech in quotes, everything else narrated in *asterisks* — "That\u2019s fine." *Kate pushed herself up onto her feet.* The conversation reads as a scene.',
}

const EMOJI: { value: EmojiUsage; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'rare', label: 'Rare' },
  { value: 'frequent', label: 'Often' },
]

function emptyDraft(): CharacterDraft {
  return { name: '', ...CHARACTER_DEFAULTS }
}

function toDraft(character: Character): CharacterDraft {
  const { id: _id, created_at: _c, updated_at: _u, ...draft } = character
  return draft
}

export function CharacterStudio({
  character,
  onClose,
}: {
  character: Character | null
  onClose: () => void
}) {
  const create = useCharacterStore((s) => s.create)
  const update = useCharacterStore((s) => s.update)
  const setActive = useCharacterStore((s) => s.setActive)
  const activeId = useSettingsStore((s) => s.settings?.active_character_id)
  const contextWindow = useEngineStore((s) => s.contextWindow)
  const charsPerToken = useEngineStore((s) => s.charsPerToken)
  const generateAvatar = useAvatarStore((s) => s.generate)
  const generatingFor = useAvatarStore((s) => s.generatingFor)
  const avatarError = useAvatarStore((s) => s.error)

  const [section, setSection] = useState<Section>('basics')
  const [draft, setDraft] = useState<CharacterDraft>(() =>
    character ? toDraft(character) : emptyDraft(),
  )
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  // Avatar generation writes straight to the store, so the draft has to pick the new
  // picture up. Without this the editor keeps showing the old face, and worse, saving
  // would write the stale avatar_path back over the one just generated.
  const savedAvatar = character?.avatar_path ?? null
  const savedSeed = character?.appearance_seed ?? null
  const savedVariant = character?.avatar_variant ?? 0
  useEffect(() => {
    setDraft((d) =>
      d.avatar_path === savedAvatar &&
      d.appearance_seed === savedSeed &&
      d.avatar_variant === savedVariant
        ? d
        : {
            ...d,
            avatar_path: savedAvatar,
            appearance_seed: savedSeed,
            avatar_variant: savedVariant,
          },
    )
  }, [savedAvatar, savedSeed, savedVariant])

  // Live preview of exactly what the model will be given. Cheap, because
  // buildSystemPrompt is pure — and the only way this is debuggable at all.
  //
  // The depth note is shown with it, and counted with it. It is not part of the system
  // prompt — it is injected next to the turn being answered — but it carries rules that
  // used to live here, so leaving it out would make the preview look thinner than what
  // the model actually gets and under-report what the persona costs.
  const preview = useMemo(() => {
    const previewCharacter = {
      ...draft,
      id: character?.id ?? 'preview',
      created_at: '',
    }
    const system = buildSystemPrompt({ character: previewCharacter })
    const note = buildDepthNote({ character: previewCharacter })
    return note
      ? `${system}\n\n--- sent again next to the latest turn ---\n${note}`
      : system
  }, [draft, character?.id])

  // What the persona costs, measured with the same estimator and the same reservation
  // arithmetic `packContext` uses — a parallel calculation here would drift and start
  // lying. A character who eats half the window is the real cause of "it forgets fast".
  const budget = useMemo(() => {
    const estimator = createEstimator(charsPerToken ?? undefined)
    const window = contextWindow ?? 4096
    const personaTokens = estimator.estimate(preview)
    const reservation = Math.max(64, Math.floor(window * 0.25))
    const forHistory = Math.max(0, window - reservation - personaTokens)
    return { personaTokens, window, forHistory }
  }, [preview, charsPerToken, contextWindow])

  const budgetTone =
    budget.personaTokens > 1200
      ? 'text-danger'
      : budget.personaTokens > 900
        ? 'text-amber-400'
        : 'text-muted'

  const nameOk = draft.name.trim().length > 0
  // Either a compiled persona or a hand-written prompt is enough; requiring both
  // would make the structured editor unable to create anything.
  const personaOk =
    hasRichPersona({ ...draft, id: 'x', created_at: '' }) ||
    draft.system_prompt.trim().length > 0
  const canSave = nameOk && personaOk && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      if (character) {
        await update({ id: character.id, ...draft })
      } else {
        const created = await create(draft)
        if (!activeId) await setActive(created.id)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const avatarBusy = generatingFor === character?.id

  /** Writes a generated field back, splitting the ones the editor stores as lists. */
  const applyWritten = (field: WritableField, text: string) => {
    if (field === 'example_dialogue') {
      const pair = parseExampleExchange(text)
      if (pair) set('example_dialogue', [...draft.example_dialogue, pair])
      return
    }
    if (isListField(field) && (field === 'personality_traits' || field === 'interests')) {
      set(
        field,
        text
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      )
      return
    }
    set(field as 'backstory', text)
  }

  const fieldHasContent = (field: WritableField): boolean => {
    if (field === 'personality_traits') return draft.personality_traits.length > 0
    if (field === 'interests') return draft.interests.length > 0
    if (field === 'example_dialogue') return false
    return Boolean((draft[field as keyof CharacterDraft] as string)?.trim())
  }

  /** A label with the model-assist button sitting on its right. */
  const fieldLabel = (text: string, field: WritableField, assistLabel?: string) => (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <Label className="mb-0">{text}</Label>
      <AiFieldButton
        field={field}
        draft={draft}
        hasContent={fieldHasContent(field)}
        onResult={(written) => applyWritten(field, written)}
        label={assistLabel ?? text.toLowerCase()}
      />
    </div>
  )

  return (
    <div className="flex h-full w-full flex-col bg-app">
      <header className="titlebar-drag flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4 sm:px-6">
        <div className="titlebar-no-drag flex min-w-0 items-center gap-2.5 pl-16 sm:pl-0">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="truncate text-sm font-medium text-white">
            {character ? `Edit ${character.name}` : 'New character'}
          </h2>
        </div>
        <div className="titlebar-no-drag flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" disabled={!canSave} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save character'}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 overflow-y-auto border-r border-border-subtle p-3">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                section === id
                  ? 'bg-card text-white'
                  : 'text-muted hover:bg-card/60 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
          {!personaOk && nameOk && (
            <p className="mt-3 px-3 text-[11px] leading-relaxed text-amber-400/90">
              Add a backstory, some traits or a speaking style — or write a system
              prompt under Advanced.
            </p>
          )}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            {section === 'basics' && (
              <>
                <div className="flex items-center gap-4">
                  <Avatar
                    character={{
                      ...draft,
                      id: character?.id ?? 'preview',
                      created_at: '',
                    }}
                    size="xl"
                  />
                  <div className="text-xs text-muted">
                    {draft.avatar_path
                      ? 'Generated from how you described them under Appearance.'
                      : 'No picture yet — describe how they look under Appearance, then generate one.'}
                  </div>
                </div>
                <div>
                  <Label>Name</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Mira"
                  />
                </div>
                <div>
                  {fieldLabel('Tagline', 'description', 'a tagline')}
                  <Input
                    value={draft.description}
                    onChange={(e) => set('description', e.target.value)}
                    placeholder="One line, shown in the sidebar"
                  />
                </div>
                <div>
                  <Label>Pronouns</Label>
                  <Input
                    value={draft.pronouns}
                    onChange={(e) => set('pronouns', e.target.value)}
                    placeholder="she/her, he/him, they/them…"
                  />
                </div>
              </>
            )}

            {section === 'story' && (
              <>
                <div>
                  {fieldLabel('Backstory', 'backstory', 'a backstory')}
                  <TextArea
                    value={draft.backstory}
                    onChange={(e) => set('backstory', e.target.value)}
                    placeholder="Where they come from, what they do, what shaped them. Write it as if describing a real person."
                    className="min-h-[180px]"
                  />
                </div>
                <div>
                  {fieldLabel('The scene', 'scenario', 'the scene')}
                  <TextArea
                    value={draft.scenario}
                    onChange={(e) => set('scenario', e.target.value)}
                    placeholder="Where and when your conversations happen."
                    className="min-h-[90px]"
                  />
                </div>
                <div>
                  {fieldLabel('Things they always know', 'key_memories', 'some shared history')}
                  <TextArea
                    value={draft.key_memories}
                    onChange={(e) => set('key_memories', e.target.value)}
                    placeholder="Shared history you want them to start out with."
                    className="min-h-[90px]"
                  />
                </div>
              </>
            )}

            {section === 'personality' && (
              <>
                <div>
                  {fieldLabel('Core traits', 'personality_traits', 'their traits')}
                  <TagInput
                    value={draft.personality_traits}
                    onChange={(v) => set('personality_traits', v)}
                    placeholder="dry humour, stubborn, warm… (Enter or comma)"
                  />
                </div>
                <div>
                  {fieldLabel('Good at', 'strengths', 'their strengths')}
                  <TextArea
                    value={draft.strengths}
                    onChange={(e) => set('strengths', e.target.value)}
                    className="min-h-[70px]"
                  />
                </div>
                <div>
                  {fieldLabel('Struggles with', 'weaknesses', 'their flaws')}
                  <TextArea
                    value={draft.weaknesses}
                    onChange={(e) => set('weaknesses', e.target.value)}
                    placeholder="Flaws make a character feel real — don't skip this."
                    className="min-h-[70px]"
                  />
                </div>
                <div>
                  {fieldLabel('Habits and quirks', 'quirks', 'their quirks')}
                  <TextArea
                    value={draft.quirks}
                    onChange={(e) => set('quirks', e.target.value)}
                    className="min-h-[70px]"
                  />
                </div>
                <div>
                  {fieldLabel('What matters to them', 'core_values', 'their values')}
                  <TextArea
                    value={draft.core_values}
                    onChange={(e) => set('core_values', e.target.value)}
                    className="min-h-[70px]"
                  />
                </div>
                <div>
                  {fieldLabel('Interests', 'interests', 'their interests')}
                  <TagInput
                    value={draft.interests}
                    onChange={(v) => set('interests', v)}
                    placeholder="architecture, cold-water swimming…"
                  />
                </div>
              </>
            )}

            {section === 'voice' && (
              <>
                <div>
                  {fieldLabel('How they speak', 'speaking_style', 'their speaking style')}
                  <TextArea
                    value={draft.speaking_style}
                    onChange={(e) => set('speaking_style', e.target.value)}
                    placeholder="Rhythm, vocabulary, verbal tics. Do they tease? Swear? Trail off?"
                    className="min-h-[110px]"
                  />
                </div>
                <div>
                  <Label>Narration</Label>
                  <Segmented
                    value={draft.narration_style}
                    options={NARRATION}
                    onChange={(v) => set('narration_style', v)}
                  />
                  <p className="mt-2 text-xs text-muted">
                    {NARRATION_HINT[draft.narration_style]}
                  </p>
                </div>
                <div>
                  <Label>Reply length</Label>
                  <Segmented
                    value={draft.response_length}
                    options={LENGTHS}
                    onChange={(v) => set('response_length', v)}
                  />
                </div>
                <div>
                  <Label>Emoji</Label>
                  <Segmented
                    value={draft.emoji_usage}
                    options={EMOJI}
                    onChange={(v) => set('emoji_usage', v)}
                  />
                </div>
                <div>
                  {fieldLabel('Voice samples', 'example_dialogue', 'another sample')}
                  <p className="mb-2 text-xs text-muted">
                    The strongest lever on how they sound. These are shown as examples,
                    not as things that happened.
                  </p>
                  <ExampleDialogueEditor
                    value={draft.example_dialogue}
                    onChange={(v) => set('example_dialogue', v)}
                    characterName={draft.name}
                  />
                </div>
              </>
            )}

            {section === 'relationship' && (
              <>
                <div>
                  {fieldLabel('What you are to each other', 'relationship_to_user', 'the relationship')}
                  <TextArea
                    value={draft.relationship_to_user}
                    onChange={(e) => set('relationship_to_user', e.target.value)}
                    placeholder="Old friends? Just met? Something unspoken?"
                    className="min-h-[90px]"
                  />
                </div>
                <div>
                  <Label>What they call you</Label>
                  <Input
                    value={draft.user_alias}
                    onChange={(e) => set('user_alias', e.target.value)}
                    placeholder="Leave empty to use your name from Settings"
                  />
                </div>
                <div>
                  {fieldLabel('Opening line', 'greeting', 'an opening line')}
                  <TextArea
                    value={draft.greeting}
                    onChange={(e) => set('greeting', e.target.value)}
                    placeholder="How they start a new conversation."
                    className="min-h-[90px]"
                  />
                </div>
                <div>
                  {fieldLabel('Limits', 'boundaries', 'the limits')}
                  <TextArea
                    value={draft.boundaries}
                    onChange={(e) => set('boundaries', e.target.value)}
                    placeholder="Anything you want them to steer away from."
                    className="min-h-[70px]"
                  />
                </div>
              </>
            )}

            {section === 'appearance' && (
              <>
                <div>
                  {fieldLabel('How they look', 'appearance_prompt', 'their appearance')}
                  <TextArea
                    value={draft.appearance_prompt}
                    onChange={(e) => set('appearance_prompt', e.target.value)}
                    placeholder="a 32 year old woman, dark curly hair, warm brown eyes, slim build…"
                    className="min-h-[90px]"
                  />
                  <p className="mt-1.5 text-xs text-muted">
                    Goes into every picture of them, first and unchanged. Describe the
                    person, not the scene.
                  </p>
                </div>
                <div>
                  <Label>Picture style</Label>
                  <Input
                    value={draft.selfie_style_prompt}
                    onChange={(e) => set('selfie_style_prompt', e.target.value)}
                    placeholder="Leave empty for a candid phone-photo look"
                  />
                </div>
                <div>
                  <Label>Never show</Label>
                  <Input
                    value={draft.appearance_negative_prompt}
                    onChange={(e) => set('appearance_negative_prompt', e.target.value)}
                    placeholder="Added to the negative prompt"
                  />
                </div>

                <div className="rounded-xl border border-border bg-card/40 p-4">
                  <div className="flex items-center gap-4">
                    <Avatar
                      character={{
                        ...draft,
                        id: character?.id ?? 'preview',
                        created_at: '',
                      }}
                      size="xl"
                    />
                    <div className="min-w-0 flex-1">
                      {character ? (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="accent"
                              size="sm"
                              disabled={avatarBusy || !draft.appearance_prompt.trim()}
                              onClick={() =>
                                void generateAvatar({
                                  ...character,
                                  ...draft,
                                })
                              }
                            >
                              {avatarBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Camera className="h-3.5 w-3.5" />
                              )}
                              {draft.avatar_path ? 'Regenerate' : 'Generate picture'}
                            </Button>
                            {draft.avatar_path && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={avatarBusy}
                                onClick={() =>
                                  void generateAvatar(
                                    { ...character, ...draft },
                                    { reroll: true },
                                  )
                                }
                              >
                                Re-roll face
                              </Button>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-muted">
                            {draft.appearance_seed != null
                              ? `Face locked to seed ${draft.appearance_seed}. Re-rolling changes it everywhere, including photos they send.`
                              : 'Generating locks in a seed so every later picture shows the same face.'}
                          </p>
                          {avatarError && (
                            <p className="mt-2 text-xs text-danger">{avatarError}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted">
                          Save the character first, then come back to generate a
                          picture.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted">
                  When you ask for a picture in the chat, this description and the
                  locked seed are used so it is recognisably them.
                </p>
              </>
            )}

            {section === 'memory' &&
              (character ? (
                <MemoryPanel character={character} />
              ) : (
                <p className="text-xs text-muted">
                  Save the character first — there is nothing to remember yet.
                </p>
              ))}

            {section === 'advanced' && (
              <>
                <RangeField
                  label="Temperature"
                  value={draft.temperature}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(temperature) => set('temperature', temperature)}
                  display={draft.temperature.toFixed(2)}
                />
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={draft.memory_enabled}
                    onChange={(e) => set('memory_enabled', e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  Remember things across conversations
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={draft.prompt_override_enabled}
                    onChange={(e) => set('prompt_override_enabled', e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  Use the raw system prompt instead of the persona above
                </label>
                <div>
                  <Label>System prompt</Label>
                  <TextArea
                    value={draft.system_prompt}
                    onChange={(e) => set('system_prompt', e.target.value)}
                    placeholder="You are…"
                    className="min-h-[120px] font-mono text-[13px]"
                  />
                </div>
                <div>
                  <Label>What the model actually sees</Label>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card/40 p-3.5 font-mono text-[11px] leading-relaxed text-muted">
                    {preview}
                  </pre>
                  <p className={cn('mt-1.5 text-[11px]', budgetTone)}>
                    ≈ {budget.personaTokens.toLocaleString()} tokens · leaves ~
                    {budget.forHistory.toLocaleString()} for the conversation in a{' '}
                    {budget.window.toLocaleString()} window
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
