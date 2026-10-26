import { useState } from 'react'
import { Download, FolderOpen, Loader2 } from 'lucide-react'
import type { GeneratedImage } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useImageSrc } from '@/hooks/useImageSrc'
import { ImageViewer } from './ImageViewer'

/**
 * A photo the character sent, shown inside its own message rather than as a separate
 * card. Deliberately plainer than ImageMessageCard: no prompt chips or seed metadata,
 * because to the user this is a photo from a person, not the output of a tool.
 */
export function SelfieAttachment({ image }: { image: GeneratedImage }) {
  const src = useImageSrc(image.image_path)
  const [viewerOpen, setViewerOpen] = useState(false)
  const downloadImage = useChatStore((s) => s.downloadImage)
  const openImageInFinder = useChatStore((s) => s.openImageInFinder)

  return (
    <>
      <figure className="group relative mt-2.5 inline-block max-w-sm overflow-hidden rounded-2xl rounded-tl-md border border-border">
        {src ? (
          <img
            src={src}
            alt={image.caption || 'Photo'}
            onClick={() => setViewerOpen(true)}
            className="block w-full cursor-zoom-in"
            draggable={false}
          />
        ) : (
          <div className="image-skeleton flex h-48 w-72 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          </div>
        )}

        <div className="pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={() => void downloadImage(image.image_path)}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
            aria-label="Save photo"
            title="Save photo"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void openImageInFinder(image.image_path)}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
            aria-label="Show in Finder"
            title="Show in Finder"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </figure>

      {viewerOpen && (
        <ImageViewer
          src={src}
          alt={image.caption || image.original_prompt}
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          onDownload={() => void downloadImage(image.image_path)}
        />
      )}
    </>
  )
}
