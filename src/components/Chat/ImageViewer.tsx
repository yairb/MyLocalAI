import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Download, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { cn } from '@/utils/cn'

interface ImageViewerProps {
  src: string
  alt?: string
  open: boolean
  onClose: () => void
  onDownload?: () => void
}

export function ImageViewer({
  src,
  alt = 'Generated image',
  open,
  onClose,
  onDownload,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!open) return
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [open, src])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(5, s + 0.25))
      if (e.key === '-') setScale((s) => Math.max(0.25, s - 0.25))
      if (e.key === '0') {
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.12 : 0.12
    setScale((s) => Math.min(5, Math.max(0.25, s + delta)))
  }, [])

  const onPointerDown = (e: ReactMouseEvent) => {
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerMove = (e: ReactMouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
  }

  const onPointerUp = () => {
    dragging.current = false
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-md animate-fade-in-soft"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="truncate text-sm text-white/70">{alt}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.min(5, s + 0.25))}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setScale(1)
              setOffset({ x: 0, y: 0 })
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
            title="Reset"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          {onDownload && (
            <button
              onClick={onDownload}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        className={cn(
          'relative flex flex-1 items-center justify-center overflow-hidden',
          scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        )}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-[85vh] max-w-[90vw] select-none rounded-lg object-contain shadow-2xl transition-transform duration-100"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        />
      </div>

      <p className="pb-4 text-center text-xs text-white/40">
        Scroll to zoom · Drag to pan · Esc to close · {Math.round(scale * 100)}%
      </p>
    </div>
  )
}
