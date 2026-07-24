import { cn } from '@/utils/cn'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-white',
        'placeholder:text-muted-dim outline-none transition-colors',
        'focus:border-accent/50 focus:ring-2 focus:ring-accent/20',
        className,
      )}
      {...props}
    />
  )
}

export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-white',
        'placeholder:text-muted-dim outline-none transition-colors resize-y min-h-[100px]',
        'focus:border-accent/50 focus:ring-2 focus:ring-accent/20',
        className,
      )}
      {...props}
    />
  )
}

export function Label({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <label
      className={cn(
        'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted',
        className,
      )}
    >
      {children}
    </label>
  )
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display?: string
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label className="mb-0">{label}</Label>
        <span className="text-sm tabular-nums text-white">
          {display ?? value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-accent"
      />
    </div>
  )
}
