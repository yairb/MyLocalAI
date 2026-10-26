import type { Character } from '@/types'
import { useImageSrc } from '@/hooks/useImageSrc'
import { cn } from '@/utils/cn'

const SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-8 w-8 text-[11px]',
  lg: 'h-12 w-12 text-sm',
  xl: 'h-24 w-24 text-2xl',
} as const

export type AvatarSize = keyof typeof SIZES

/** Stable per-character hue, so everyone has a recognisable colour before a face. */
function hue(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360
  }
  return hash
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function Avatar({
  character,
  size = 'md',
  className,
  ring,
}: {
  character: Character | null
  size?: AvatarSize
  className?: string
  ring?: boolean
}) {
  const src = useImageSrc(character?.avatar_path)
  const base = cn(
    'shrink-0 overflow-hidden rounded-full',
    SIZES[size],
    ring && 'ring-2 ring-accent/30',
    className,
  )

  if (!character) {
    return (
      <div
        className={cn(
          base,
          'flex items-center justify-center border border-accent/20 bg-accent-soft',
        )}
      >
        <div className="h-2.5 w-2.5 rounded-full bg-accent" />
      </div>
    )
  }

  if (src) {
    return (
      <img
        src={src}
        alt={character.name}
        className={cn(base, 'object-cover')}
        draggable={false}
      />
    )
  }

  return (
    <div
      className={cn(base, 'flex items-center justify-center font-semibold text-white')}
      style={{ backgroundColor: `hsl(${hue(character.id)} 42% 34%)` }}
      aria-label={character.name}
    >
      {initials(character.name)}
    </div>
  )
}
