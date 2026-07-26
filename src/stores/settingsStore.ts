import { create } from 'zustand'
import type { AppSettings } from '@/types'
import * as db from '@/services/database'
import {
  getImageModelsDir,
  listLocalImageModels,
  pickImageModelFile,
} from '@/services/imageGeneration'

interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  modelsDir: string
  localModels: string[]
  imageModelsDir: string
  localImageModels: string[]
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
  refreshModels: () => Promise<void>
  pickModel: () => Promise<void>
  refreshImageModels: () => Promise<void>
  pickImageModel: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: true,
  modelsDir: '',
  localModels: [],
  imageModelsDir: '',
  localImageModels: [],

  load: async () => {
    set({ loading: true })
    try {
      const [settings, modelsDir, localModels, imageModelsDir, localImageModels] =
        await Promise.all([
          db.getSettings(),
          db.getModelsDir(),
          db.listLocalModels(),
          getImageModelsDir(),
          listLocalImageModels(),
        ])
      set({
        settings,
        modelsDir,
        localModels,
        imageModelsDir,
        localImageModels,
        loading: false,
      })
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

  refreshImageModels: async () => {
    const localImageModels = await listLocalImageModels()
    set({ localImageModels })
  },

  pickImageModel: async () => {
    const backend = get().settings?.image_backend ?? 'mlx'
    const path = await pickImageModelFile(backend)
    if (!path) return
    const name = path.split('/').pop() ?? path
    await get().update({ image_model_path: path, image_model_name: name })
    await get().refreshImageModels()
  },
}))
