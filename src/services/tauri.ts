import { invoke } from '@tauri-apps/api/core'

/** Detect whether we are running inside a Tauri webview */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(cmd, args)
}
