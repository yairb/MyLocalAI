import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  FolderOpen,
  ImageIcon,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { Message } from '@/types'
import { imagePathToSrc } from '@/services/imageGeneration'
import { useChatStore } from '@/stores/chatStore'
import { ImageViewer } from './ImageViewer'
import { cn } from '@/utils/cn'

interface ImageMessageCardProps {
  message: Message
}

export function ImageMessageCard({ message }: ImageMessageCardProps) {
  const image = message.image
  const [src, setSrc] = useState<string>('')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [copied, setCopied] = useState<'original' | 'enhanced' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const regenerateImage = useChatStore((s) => s.regenerateImage)
  const deleteImageMessage = useChatStore((s) => s.deleteImageMessage)
  const downloadImage = useChatStore((s) => s.downloadImage)
  const openImageInFinder = useChatStore((s) => s.openImageInFinder)
  const isGeneratingImage = useChatStore((s) => s.isGeneratingImage)

  useEffect(() => {
    if (!image?.image_path) return
    let cancelled = false
    void imagePathToSrc(image.image_path).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [image?.image_path])

  if (!image) {
    return (
      <div className="flex justify-start animate-fade-in">
        <div className="rounded-2xl border border-border bg-card/40 px-4 py-3 text-sm text-muted">
          Image unavailable
        </div>
      </div>
    )
  }

  const copyText = async (text: string, kind: 'original' | 'enhanced') => {
    await navigator.clipboard.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied(null), 1500)
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await deleteImageMessage(message.id)
    setConfirmDelete(false)
  }

  const genSeconds = (image.generation_time_ms / 1000).toFixed(1)

  return (
    <>
      <div className="flex justify-start animate-fade-in">
        <div className="flex max-w-[90%] items-start gap-3 sm:max-w-[80%]">
          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft border border-accent/20">
            <ImageIcon className="h-3.5 w-3.5 text-accent" />
          </div>

          <div className="group relative min-w-[260px] max-w-md overflow-hidden rounded-2xl border border-border bg-card/50 shadow-lg shadow-black/15 transition hover:border-border">
            {/* Image */}
            <button
              type="button"
              onClick={() => src && setViewerOpen(true)}
              className="relative block w-full overflow-hidden bg-[#0d0d0d] focus:outline-none"
            >
              {src ? (
                <img
                  src={src}
                  alt={image.original_prompt}
                  className="aspect-square w-full object-cover transition duration-500 animate-fade-in-soft group-hover:scale-[1.01]"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-square w-full image-skeleton" />
              )}

              {/* Hover toolbar */}
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1.5 p-2.5 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
                <div className="flex gap-1 rounded-xl border border-white/10 bg-black/55 p-1 backdrop-blur-md">
                  <ToolbarBtn
                    title="Download"
                    onClick={(e) => {
                      e.stopPropagation()
                      void downloadImage(image.image_path)
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </ToolbarBtn>
                  <ToolbarBtn
                    title="Regenerate"
                    disabled={isGeneratingImage}
                    onClick={(e) => {
                      e.stopPropagation()
                      void regenerateImage(message.id)
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </ToolbarBtn>
                  <ToolbarBtn
                    title="Open in Finder"
                    onClick={(e) => {
                      e.stopPropagation()
                      void openImageInFinder(image.image_path)
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </ToolbarBtn>
                  <ToolbarBtn
                    title={confirmDelete ? 'Click again to confirm' : 'Delete'}
                    danger
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete()
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </ToolbarBtn>
                </div>
              </div>
            </button>

            {/* Prompt + actions */}
            <div className="space-y-2.5 px-4 py-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">
                  Prompt
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-white/90">
                  {image.original_prompt}
                </p>
              </div>

              {image.enhanced_prompt &&
                image.enhanced_prompt !== image.original_prompt && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">
                      Enhanced
                    </p>
                    <p className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-muted">
                      {image.enhanced_prompt}
                    </p>
                  </div>
                )}

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <ActionChip
                  onClick={() => void copyText(image.original_prompt, 'original')}
                >
                  {copied === 'original' ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Prompt
                </ActionChip>
                {image.enhanced_prompt &&
                  image.enhanced_prompt !== image.original_prompt && (
                    <ActionChip
                      onClick={() =>
                        void copyText(image.enhanced_prompt, 'enhanced')
                      }
                    >
                      {copied === 'enhanced' ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      Enhanced
                    </ActionChip>
                  )}
                <ActionChip
                  onClick={() => void downloadImage(image.image_path)}
                >
                  <Download className="h-3 w-3" />
                  Download
                </ActionChip>
                <ActionChip
                  disabled={isGeneratingImage}
                  onClick={() => void regenerateImage(message.id)}
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </ActionChip>
                <ActionChip
                  danger={confirmDelete}
                  onClick={() => void handleDelete()}
                  onBlur={() => setConfirmDelete(false)}
                >
                  <Trash2 className="h-3 w-3" />
                  {confirmDelete ? 'Confirm?' : 'Delete'}
                </ActionChip>
              </div>

              <p className="text-[11px] text-muted-dim">
                {image.width}×{image.height} · seed {image.seed} ·{' '}
                {image.steps} steps · {image.sampler} · {genSeconds}s
              </p>
            </div>
          </div>
        </div>
      </div>

      <ImageViewer
        open={viewerOpen}
        src={src}
        alt={image.original_prompt}
        onClose={() => setViewerOpen(false)}
        onDownload={() => void downloadImage(image.image_path)}
      />
    </>
  )
}

function ToolbarBtn({
  children,
  onClick,
  title,
  danger,
  disabled,
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  title: string
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition',
        danger
          ? 'text-red-300 hover:bg-red-500/20 hover:text-red-200'
          : 'text-white/80 hover:bg-white/15 hover:text-white',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  )
}

function ActionChip({
  children,
  onClick,
  onBlur,
  danger,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  onBlur?: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onBlur={onBlur}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition',
        danger
          ? 'border-red-500/40 bg-danger-soft text-red-300 hover:bg-red-500/20'
          : 'border-border bg-card/80 text-muted hover:border-border hover:bg-card-hover hover:text-white',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  )
}
