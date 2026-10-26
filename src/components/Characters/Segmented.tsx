import { cn } from '@/utils/cn'

/** A small inline choice, for dials where a slider would overstate the precision. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-card p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[10px] px-3 py-1.5 text-xs font-medium transition',
            value === option.value
              ? 'bg-accent text-white'
              : 'text-muted hover:text-white',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
