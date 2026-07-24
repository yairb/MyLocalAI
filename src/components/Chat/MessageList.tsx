import { useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { MessageBubble } from './MessageBubble'
import { EmptyState } from './EmptyState'

export function MessageList() {
  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamingContent, isGenerating])

  const showEmpty =
    !activeConversationId ||
    (messages.length === 0 && !isGenerating)

  if (showEmpty) {
    return <EmptyState />
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isGenerating && (
          <MessageBubble
            streaming={streamingContent}
            isStreaming
          />
        )}
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  )
}
