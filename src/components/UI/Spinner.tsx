import { cn } from '@/utils/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-accent',
        className,
      )}
    />
  )
}

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
    </div>
  )
}
