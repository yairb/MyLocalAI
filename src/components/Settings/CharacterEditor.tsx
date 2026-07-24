import { useState } from 'react'
import { Pencil, Plus, Trash2, Check } from 'lucide-react'
import { useCharacterStore } from '@/stores/characterStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Button } from '@/components/UI/Button'
import { Input, Label, TextArea, RangeField } from '@/components/UI/Input'
import { Modal } from '@/components/UI/Modal'
import { cn } from '@/utils/cn'
import type { Character } from '@/types'

const emptyForm = {
  name: '',
  description: '',
  system_prompt: '',
  temperature: 0.7,
}

export function CharacterEditor() {
  const characters = useCharacterStore((s) => s.characters)
  const create = useCharacterStore((s) => s.create)
  const update = useCharacterStore((s) => s.update)
  const remove = useCharacterStore((s) => s.remove)
  const setActive = useCharacterStore((s) => s.setActive)
  const activeId = useSettingsStore((s) => s.settings?.active_character_id)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Character | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setOpen(true)
  }

  const openEdit = (c: Character) => {
    setEditing(c)
    setForm({
      name: c.name,
      description: c.description,
      system_prompt: c.system_prompt,
      temperature: c.temperature,
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.system_prompt.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await update({ id: editing.id, ...form })
      } else {
        const created = await create(form)
        if (!activeId) await setActive(created.id)
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Characters</h3>
          <p className="mt-0.5 text-xs text-muted">
            Personalities and system prompts for your local AI
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {characters.map((c) => {
          const active = c.id === activeId || (!activeId && c === characters[0])
          return (
            <div
              key={c.id}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-3.5 py-3 transition',
                active
                  ? 'border-accent/40 bg-accent-soft'
                  : 'border-border bg-card/40 hover:bg-card',
              )}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => void setActive(c.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  {active && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      <Check className="h-2.5 w-2.5" /> Active
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                  {c.description || 'No description'}
                </p>
              </button>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => openEdit(c)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover hover:text-white"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete character “${c.name}”?`)) {
                      void remove(c.id)
                    }
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit character' : 'New character'}
        wide
      >
        <div className="flex flex-col gap-4">
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Coding Expert"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Short summary shown in the UI"
            />
          </div>
          <div>
            <Label>System prompt</Label>
            <TextArea
              value={form.system_prompt}
              onChange={(e) =>
                setForm({ ...form, system_prompt: e.target.value })
              }
              placeholder="You are…"
              className="min-h-[140px] font-mono text-[13px]"
            />
          </div>
          <RangeField
            label="Temperature"
            value={form.temperature}
            min={0}
            max={2}
            step={0.05}
            onChange={(temperature) => setForm({ ...form, temperature })}
            display={form.temperature.toFixed(2)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              disabled={saving || !form.name.trim() || !form.system_prompt.trim()}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save character'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
