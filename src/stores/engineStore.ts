import { create } from 'zustand'
import type { EngineState, EngineStatus } from '@/types'
import * as db from '@/services/database'

interface EngineStore extends EngineState {
  pollTimer: ReturnType<typeof setInterval> | null
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  status: 'checking',
  message: 'Checking AI engine…',
  progress: 0,
  model_loaded: null,
  error: undefined,
  pollTimer: null,

  refresh: async () => {
    try {
      const res = await db.getEngineStatus()
      set({
        status: res.status as EngineStatus,
        message: res.message,
        progress: res.progress,
        model_loaded: res.model_loaded,
        error: res.error ?? undefined,
      })
    } catch (e) {
      set({
        status: 'error',
        message: 'Failed to reach engine',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  },

  start: async () => {
    set({ status: 'starting', message: 'Starting AI engine…', progress: 10 })
    try {
      const res = await db.startEngine()
      set({
        status: res.status as EngineStatus,
        message: res.message,
        progress: res.progress,
        model_loaded: res.model_loaded,
        error: res.error ?? undefined,
      })
    } catch (e) {
      set({
        status: 'error',
        message: 'Failed to start engine',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  },

  stop: async () => {
    await db.stopEngine()
    set({
      status: 'idle',
      message: 'Engine stopped',
      progress: 0,
      model_loaded: null,
    })
  },

  startPolling: () => {
    get().stopPolling()
    void get().refresh()
    const pollTimer = setInterval(() => {
      void get().refresh()
    }, 2000)
    set({ pollTimer })
  },

  stopPolling: () => {
    const { pollTimer } = get()
    if (pollTimer) clearInterval(pollTimer)
    set({ pollTimer: null })
  },
}))
