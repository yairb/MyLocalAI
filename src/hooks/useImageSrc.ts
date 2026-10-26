import { useEffect, useState } from 'react'
import { imagePathToSrc } from '@/services/imageGeneration'

/**
 * Resolves a filesystem path to something an <img> can load.
 *
 * `imagePathToSrc` is async because it dynamically imports the Tauri API. With an
 * avatar beside every message that would mean dozens of resolutions per render, and a
 * visible flash each time, so results are memoized for the life of the session and
 * returned synchronously on a repeat hit.
 */
const cache = new Map<string, string>()

export function useImageSrc(path: string | null | undefined): string {
  const [src, setSrc] = useState(() => (path ? (cache.get(path) ?? '') : ''))

  useEffect(() => {
    if (!path) {
      setSrc('')
      return
    }
    const cached = cache.get(path)
    if (cached) {
      setSrc(cached)
      return
    }
    let cancelled = false
    void imagePathToSrc(path).then((resolved) => {
      cache.set(path, resolved)
      if (!cancelled) setSrc(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return src
}
