import { cn } from '../lib/utils'

const tones: Record<string, string> = {
  IDLE: 'bg-slate-100 text-slate-600',
  NAVIGATING: 'bg-emerald-100 text-emerald-700',
  PLANNING: 'bg-indigo-100 text-indigo-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  ERROR: 'bg-red-100 text-red-700',
  EMERGENCY_STOP: 'bg-red-600 text-white',
  OFFLINE: 'bg-slate-200 text-slate-500',
  CREATED: 'bg-amber-100 text-amber-700',
  ASSIGNED: 'bg-sky-100 text-sky-700',
  RUNNING: 'bg-emerald-100 text-emerald-700',
  DONE: 'bg-emerald-600 text-white',
  CANCELED: 'bg-slate-200 text-slate-600',
  FAILED: 'bg-red-100 text-red-700',
  INFO: 'bg-sky-100 text-sky-700',
  WARN: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-600 text-white',
  LOW: 'bg-slate-100 text-slate-600',
  NORMAL: 'bg-slate-100 text-slate-600',
  HIGH: 'bg-amber-100 text-amber-700',
  URGENT: 'bg-red-100 text-red-700',
}

export function StatusBadge({
  value,
  className,
}: {
  value: string | null | undefined
  className?: string
}) {
  const label = value ?? '--'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold tracking-[0.02em]',
        tones[label] ?? 'bg-slate-100 text-slate-600',
        className,
      )}
    >
      {label}
    </span>
  )
}
