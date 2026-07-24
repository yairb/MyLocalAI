import { create } from 'zustand'
import type { AppSettings } from '@/types'
import * as db from '@/services/database'

interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  modelsDir: string
  localModels: string[]
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
  refreshModels: () => Promise<void>
  pickModel: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: true,
  modelsDir: '',
  localModels: [],

  load: async () => {
    set({ loading: true })
    try {
      const [settings, modelsDir, localModels] = await Promise.all([
        db.getSettings(),
        db.getModelsDir(),
        db.listLocalModels(),
      ])
      set({ settings, modelsDir, localModels, loading: false })
    } catch (e) {
      console.error('Failed to load settings', e)
      set({ loading: false })
    }
  },

  update: async (patch) => {
    const next = await db.updateSettings(patch)
    set({ settings: next })
  },

  refreshModels: async () => {
    const localModels = await db.listLocalModels()
    set({ localModels })
  },

  pickModel: async () => {
    const path = await db.pickModelFile()
    if (!path) return
    const name = path.split('/').pop() ?? path
    await get().update({ model_path: path, model_name: name })
    await get().refreshModels()
  },
}))
