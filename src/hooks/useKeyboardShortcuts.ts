import { useEffect } from 'react'

interface ShortcutHandlers {
  onNewChat: () => void
  onSearch: () => void
  onSettings: () => void
}

export function useKeyboardShortcuts({
  onNewChat,
  onSearch,
  onSettings,
}: ShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return

      const key = e.key.toLowerCase()

      if (key === 'n') {
        e.preventDefault()
        onNewChat()
      } else if (key === 'k') {
        e.preventDefault()
        onSearch()
      } else if (key === ',') {
        e.preventDefault()
        onSettings()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onNewChat, onSearch, onSettings])
}
