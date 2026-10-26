import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { ChatArea } from '@/components/Chat/ChatArea'
import { LoadingScreen } from '@/components/Chat/LoadingScreen'
import { SettingsPage } from '@/components/Settings/SettingsPage'
import { CharacterGallery } from '@/components/Characters/CharacterGallery'
import { useChatStore } from '@/stores/chatStore'
import { useCharacterStore } from '@/stores/characterStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEngineStore } from '@/stores/engineStore'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { drainPendingMemoryWork } from '@/services/memory'
import { useCharacterStore as useCharacters } from '@/stores/characterStore'

type View = 'boot' | 'chat' | 'settings' | 'characters'

export default function App() {
  const [view, setView] = useState<View>('boot')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)

  const loadConversations = useChatStore((s) => s.loadConversations)
  const newChat = useChatStore((s) => s.newChat)
  const requestInputFocus = useChatStore((s) => s.requestInputFocus)
  const loadCharacters = useCharacterStore((s) => s.load)
  const loadSettings = useSettingsStore((s) => s.load)
  const engineStart = useEngineStore((s) => s.start)
  const startPolling = useEngineStore((s) => s.startPolling)
  const stopPolling = useEngineStore((s) => s.stopPolling)
  const engineStatus = useEngineStore((s) => s.status)

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      await Promise.all([loadSettings(), loadCharacters(), loadConversations()])
      if (cancelled) return
      startPolling()
      await engineStart()
      if (cancelled) return
      // Auto-enter chat once ready or after a short wait if no model
      const status = useEngineStore.getState().status
      if (status === 'ready') {
        setView('chat')
      }
    }

    void boot()
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [
    loadSettings,
    loadCharacters,
    loadConversations,
    engineStart,
    startPolling,
    stopPolling,
  ])

  // Auto-transition when engine becomes ready during boot
  useEffect(() => {
    if (view === 'boot' && engineStatus === 'ready') {
      setView('chat')
    }
  }, [view, engineStatus])

  // Memory work skipped while the engine was stopped for an image runs now.
  useEffect(() => {
    if (engineStatus !== 'ready') return
    drainPendingMemoryWork((conversationId) => {
      const chat = useChatStore.getState()
      if (chat.activeConversationId !== conversationId) return null
      const conversation = chat.conversations.find((c) => c.id === conversationId)
      return {
        conversationId,
        character: useCharacters.getState().getForConversation(conversation ?? null),
        messages: chat.messages,
        userName:
          useSettingsStore.getState().settings?.user_name?.trim() || 'the user',
      }
    })
  }, [engineStatus])

  const openSettings = useCallback(() => setView('settings'), [])
  const openChat = useCallback(() => setView('chat'), [])
  const openCharacters = useCallback(() => setView('characters'), [])

  const handleNewChat = useCallback(() => {
    setView('chat')
    void newChat()
    requestInputFocus()
  }, [newChat, requestInputFocus])

  const handleSearch = useCallback(() => {
    setSidebarOpen(true)
    setSearchOpen(true)
    setView('chat')
  }, [])

  useKeyboardShortcuts({
    onNewChat: handleNewChat,
    onSearch: handleSearch,
    onSettings: openSettings,
  })

  if (view === 'boot') {
    return (
      <LoadingScreen
        onOpenSettings={() => setView('settings')}
        onContinue={() => setView('chat')}
      />
    )
  }

  if (view === 'settings') {
    return (
      <div className="flex h-full">
        <SettingsPage onBack={openChat} onOpenCharacters={openCharacters} />
      </div>
    )
  }

  if (view === 'characters') {
    return (
      <div className="flex h-full">
        <CharacterGallery onBack={openChat} onStartChat={openChat} />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenCharacters={openCharacters}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
      />
      <ChatArea onOpenSettings={openSettings} onOpenCharacters={openCharacters} />
    </div>
  )
}
