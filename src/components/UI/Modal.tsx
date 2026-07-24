import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  wide?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  wide,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in-soft">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative w-full rounded-2xl border border-border bg-sidebar shadow-2xl shadow-black/40',
          wide ? 'max-w-2xl' : 'max-w-lg',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
