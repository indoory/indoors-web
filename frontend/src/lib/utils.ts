import clsx, { type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '--'
  }

  const date = new Date(value)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return '--'
  }

  const date = new Date(value)
  const diff = date.getTime() - Date.now()
  const minutes = Math.round(diff / 60000)
  const absMinutes = Math.abs(minutes)

  if (absMinutes < 1) {
    return 'just now'
  }

  if (absMinutes < 60) {
    return minutes < 0 ? `${absMinutes} min ago` : `in ${absMinutes} min`
  }

  const hours = Math.round(absMinutes / 60)
  if (hours < 24) {
    return minutes < 0 ? `${hours}h ago` : `in ${hours}h`
  }

  const days = Math.round(hours / 24)
  return minutes < 0 ? `${days}d ago` : `in ${days}d`
}

export function toTitle(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ')
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? '')
    .join('')
}

export function isToday(value: string | null | undefined) {
  if (!value) {
    return false
  }

  const date = new Date(value)
  const now = new Date()

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}
