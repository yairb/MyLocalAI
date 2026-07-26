import { useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { MessageBubble } from './MessageBubble'
import { ImageMessageCard } from './ImageMessageCard'
import { ImageGeneratingPlaceholder } from './ImageGeneratingPlaceholder'
import { EmptyState } from './EmptyState'

interface MessageListProps {
  onOpenSettings?: () => void
}

export function MessageList({ onOpenSettings }: MessageListProps) {
  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const imageJob = useChatStore((s) => s.imageJob)
  const isGeneratingImage = useChatStore((s) => s.isGeneratingImage)
  const cancelImageGeneration = useChatStore((s) => s.cancelImageGeneration)
  const retryImageGeneration = useChatStore((s) => s.retryImageGeneration)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamingContent, isGenerating, imageJob, isGeneratingImage])

  // Tick estimated time while generating
  useEffect(() => {
    if (!isGeneratingImage || !imageJob || imageJob.status === 'error') return
    const id = window.setInterval(() => {
      // Force re-render via store identity (progress updates handle most cases)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 1000)
    return () => window.clearInterval(id)
  }, [isGeneratingImage, imageJob])

  const showEmpty =
    !activeConversationId ||
    (messages.length === 0 && !isGenerating && !imageJob)

  if (showEmpty) {
    return <EmptyState />
  }

  const showImagePlaceholder =
    imageJob &&
    (isGeneratingImage || imageJob.status === 'error') &&
    imageJob.conversation_id === activeConversationId

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {messages.map((msg) =>
          msg.role === 'image' ? (
            <ImageMessageCard key={msg.id} message={msg} />
          ) : (
            <MessageBubble key={msg.id} message={msg} />
          ),
        )}
        {isGenerating && (
          <MessageBubble streaming={streamingContent} isStreaming />
        )}
        {showImagePlaceholder && imageJob && (
          <ImageGeneratingPlaceholder
            job={imageJob}
            onCancel={cancelImageGeneration}
            onRetry={() => void retryImageGeneration()}
            onOpenSettings={onOpenSettings}
          />
        )}
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  )
}
