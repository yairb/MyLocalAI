import { cn } from '@/utils/cn'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg' | 'icon'
  children: ReactNode
}

const variants: Record<Variant, string> = {
  primary:
    'bg-white text-black hover:bg-neutral-200 disabled:bg-neutral-600 disabled:text-neutral-400',
  secondary:
    'bg-card text-white hover:bg-card-hover border border-border',
  ghost: 'bg-transparent text-muted hover:bg-card hover:text-white',
  danger: 'bg-danger-soft text-danger hover:bg-red-500/20',
  accent:
    'bg-accent text-white hover:bg-accent-hover disabled:opacity-50',
}

const sizes = {
  sm: 'h-8 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-11 px-5 text-[15px] rounded-xl gap-2',
  icon: 'h-9 w-9 rounded-lg inline-flex items-center justify-center',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        'disabled:cursor-not-allowed active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
