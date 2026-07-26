import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Conversation } from '@/types'
import { formatRelativeTime } from '@/utils/dates'
import { cn } from '@/utils/cn'
import { useChatStore } from '@/stores/chatStore'

interface ConversationItemProps {
  conversation: Conversation
  active: boolean
}

export function ConversationItem({ conversation, active }: ConversationItemProps) {
  const selectConversation = useChatStore((s) => s.selectConversation)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)

  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setTitle(conversation.title)
  }, [conversation.title])

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  useEffect(() => {
    if (!menuOpen) return

    const updateMenuPos = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
    }

    updateMenuPos()

    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      const clickedMenu = menuRef.current?.contains(target)
      const clickedTrigger = triggerRef.current?.contains(target)
      if (!clickedMenu && !clickedTrigger) setMenuOpen(false)
    }
    const onResize = () => updateMenuPos()
    const onScroll = () => updateMenuPos()

    window.addEventListener('mousedown', onClick)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuOpen])

  const commitRename = async () => {
    const next = title.trim() || 'New Chat'
    setRenaming(false)
    if (next !== conversation.title) {
      await renameConversation(conversation.id, next)
    }
  }

  return (
    <div
      className={cn(
        'group relative flex items-center rounded-xl transition-colors',
        menuOpen && 'z-30',
        active ? 'bg-card' : 'hover:bg-card/60',
      )}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename()
            if (e.key === 'Escape') {
              setTitle(conversation.title)
              setRenaming(false)
            }
          }}
          className="w-full rounded-xl bg-transparent px-3 py-2.5 text-sm outline-none ring-1 ring-accent/40"
        />
      ) : (
        <button
          onClick={() => void selectConversation(conversation.id)}
          className="flex min-w-0 flex-1 flex-col items-start px-3 py-2.5 text-left"
        >
          <span
            className={cn(
              'w-full truncate text-sm',
              active ? 'font-medium text-white' : 'text-neutral-200',
            )}
          >
            {conversation.title}
          </span>
          <span className="mt-0.5 text-[11px] text-muted-dim">
            {formatRelativeTime(conversation.updated_at)}
          </span>
        </button>
      )}

      {!renaming && (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg text-muted transition',
              'opacity-0 group-hover:opacity-100 hover:bg-card-hover hover:text-white',
              (menuOpen || active) && 'opacity-100',
            )}
            aria-label="Conversation options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      )}

      {menuOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[90] w-36 overflow-hidden rounded-xl border border-border bg-sidebar py-1 shadow-xl shadow-black/40 animate-fade-in"
          style={{ top: menuPos.top, right: menuPos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-200 hover:bg-card"
            onClick={() => {
              setMenuOpen(false)
              setRenaming(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> Rename
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft"
            onClick={() => {
              setMenuOpen(false)
              void deleteConversation(conversation.id)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
