import { create } from 'zustand'
import type { EngineState, EngineStatus } from '@/types'
import * as db from '@/services/database'
import { buildBaseUrl } from '@/services/llamaClient'
import { calibrateEstimator, resolveContextWindow } from '@/services/contextBudget'
import { useSettingsStore } from './settingsStore'

/** Enough real conversation text to calibrate the token estimator against. */
const CALIBRATION_SAMPLE = `You are Mira. You are a specific person with your own life,
body, moods and opinions. *sets the pen down* Go on then, the whole thing, not the
polite version. I've been staring at the same stairwell detail for three hours and I
think it's winning. Sometimes. Usually in February, when it rains here for three weeks
straight and I start romanticising the light. Then I remember I'd have to explain my
job to my mother again, which is its own kind of weather.`.repeat(3)

interface EngineStore extends EngineState {
  pollTimer: ReturnType<typeof setInterval> | null
  /** Real context window reported by the server, which can be smaller than the setting. */
  contextWindow: number | null
  /** Measured chars-per-token for the loaded model; null until calibrated. */
  charsPerToken: number | null
  calibratedFor: string | null
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
  /** Resolves once the model has finished loading, not just once the process exists. */
  waitForReady: (timeoutMs?: number) => Promise<boolean>
  calibrate: () => Promise<void>
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  status: 'checking',
  message: 'Checking AI engine…',
  progress: 0,
  model_loaded: null,
  error: undefined,
  pollTimer: null,
  contextWindow: null,
  charsPerToken: null,
  calibratedFor: null,

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
      if (res.status === 'ready' && get().calibratedFor !== res.model_loaded) {
        void get().calibrate()
      }
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

  waitForReady: async (timeoutMs = 90_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await get().refresh()
      const { status } = get()
      if (status === 'ready') return true
      if (status === 'error' || status === 'no_model') return false
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return false
  },

  calibrate: async () => {
    const settings = useSettingsStore.getState().settings
    const baseUrl = buildBaseUrl(
      settings?.llama_host ?? '127.0.0.1',
      settings?.llama_port ?? 8080,
    )
    const modelKey = get().model_loaded
    try {
      const [contextWindow, charsPerToken] = await Promise.all([
        resolveContextWindow(baseUrl, settings?.context_size ?? 4096),
        calibrateEstimator(CALIBRATION_SAMPLE, baseUrl).catch(() => null),
      ])
      set({
        contextWindow,
        charsPerToken: charsPerToken ?? get().charsPerToken,
        calibratedFor: modelKey,
      })
    } catch {
      // Falls back to the configured context size and the default ratio.
      set({ calibratedFor: modelKey })
    }
  },
}))
