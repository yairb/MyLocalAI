import {
  format,
  isToday,
  isYesterday,
  isThisWeek,
  parseISO,
  differenceInMinutes,
} from 'date-fns'

export function formatRelativeTime(iso: string): string {
  try {
    const date = parseISO(iso)
    const mins = differenceInMinutes(new Date(), date)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (isToday(date)) return format(date, 'HH:mm')
    if (isYesterday(date)) return `Yesterday ${format(date, 'HH:mm')}`
    return format(date, 'MMM d, HH:mm')
  } catch {
    return ''
  }
}

export type DateGroup = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older'

export function getDateGroup(iso: string): DateGroup {
  try {
    const date = parseISO(iso)
    if (isToday(date)) return 'Today'
    if (isYesterday(date)) return 'Yesterday'
    if (isThisWeek(date, { weekStartsOn: 1 })) return 'Previous 7 Days'
    return 'Older'
  } catch {
    return 'Older'
  }
}

export function groupConversationsByDate<T extends { updated_at: string }>(
  items: T[],
): Record<DateGroup, T[]> {
  const groups: Record<DateGroup, T[]> = {
    Today: [],
    Yesterday: [],
    'Previous 7 Days': [],
    Older: [],
  }
  for (const item of items) {
    groups[getDateGroup(item.updated_at)].push(item)
  }
  return groups
}
