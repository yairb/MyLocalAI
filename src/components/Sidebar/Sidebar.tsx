import { useMemo, useRef, useEffect } from 'react'
import {
  Plus,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { groupConversationsByDate, type DateGroup } from '@/utils/dates'
import { ConversationItem } from './ConversationItem'
import { cn } from '@/utils/cn'
import { useCharacterStore } from '@/stores/characterStore'
import { useSettingsStore } from '@/stores/settingsStore'

interface SidebarProps {
  open: boolean
  onToggle: () => void
  onOpenSettings: () => void
  searchOpen: boolean
  onSearchOpenChange: (open: boolean) => void
}

const GROUP_ORDER: DateGroup[] = [
  'Today',
  'Yesterday',
  'Previous 7 Days',
  'Older',
]

export function Sidebar({
  open,
  onToggle,
  onOpenSettings,
  searchOpen,
  onSearchOpenChange,
}: SidebarProps) {
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeConversationId)
  const searchQuery = useChatStore((s) => s.searchQuery)
  const setSearchQuery = useChatStore((s) => s.setSearchQuery)
  const newChat = useChatStore((s) => s.newChat)
  const characters = useCharacterStore((s) => s.characters)
  const activeCharacterId = useSettingsStore((s) => s.settings?.active_character_id)
  const character =
    characters.find((c) => c.id === activeCharacterId) ?? characters[0] ?? null
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const groups = useMemo(() => groupConversationsByDate(filtered), [filtered])

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-border-subtle bg-sidebar transition-transform duration-250 ease-out md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full md:w-0 md:border-0 md:overflow-hidden',
        )}
      >
        <div className="titlebar-drag flex h-12 shrink-0 items-center justify-between px-3 pl-20 md:pl-3">
          <span className="titlebar-no-drag text-sm font-semibold tracking-tight">
            My Local AI
          </span>
          <button
            onClick={onToggle}
            className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-card hover:text-white md:hidden"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            onClick={() => void newChat()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-medium text-black transition hover:bg-neutral-200 active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} />
            New Chat
          </button>
        </div>

        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-dim" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => onSearchOpenChange(true)}
              placeholder="Search chats…"
              className="w-full rounded-xl border border-transparent bg-card py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-muted-dim focus:border-border"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-dim">
              {searchQuery ? 'No matching chats' : 'No conversations yet'}
            </p>
          ) : (
            GROUP_ORDER.map((group) => {
              const items = groups[group]
              if (!items.length) return null
              return (
                <div key={group} className="mb-3">
                  <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-dim">
                    {group}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {items.map((c) => (
                      <ConversationItem
                        key={c.id}
                        conversation={c}
                        active={c.id === activeId}
                      />
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="shrink-0 border-t border-border-subtle p-3">
          <div className="mb-2 rounded-xl bg-card/50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-dim">
              Character
            </p>
            <p className="mt-0.5 truncate text-sm font-medium">
              {character?.name ?? 'Default'}
            </p>
          </div>
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted transition hover:bg-card hover:text-white"
          >
            <Settings className="h-4 w-4" />
            Settings
            <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-dim">
              ⌘,
            </kbd>
          </button>
        </div>
      </aside>

      {!open && (
        <button
          onClick={onToggle}
          className="fixed left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-sidebar text-muted shadow-lg transition hover:text-white md:left-3"
          aria-label="Open sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}
    </>
  )
}
