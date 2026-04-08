import type { LucideIcon } from 'lucide-react'

const toneMap = {
  slate: { icon: 'bg-slate-50 text-slate-600', border: 'border-slate-200', text: 'text-slate-900', detail: 'text-slate-500' },
  sky: { icon: 'bg-blue-50 text-blue-600', border: 'border-slate-200', text: 'text-slate-900', detail: 'text-slate-500' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', border: 'border-slate-200', text: 'text-slate-900', detail: 'text-slate-500' },
  amber: { icon: 'bg-amber-50 text-amber-600', border: 'border-amber-200', text: 'text-amber-600', detail: 'text-amber-500' },
  red: { icon: 'bg-red-50 text-red-600', border: 'border-red-200', text: 'text-red-600', detail: 'text-red-500' },
}

export function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'slate',
}: {
  icon: LucideIcon
  label: string
  value: string | number
  detail: string
  tone?: keyof typeof toneMap
}) {
  const t = toneMap[tone]

  return (
    <div className={`rounded-xl border bg-white p-5 ${t.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className={`text-sm ${tone === 'amber' || tone === 'red' ? `font-medium ${t.text}` : 'text-slate-500'}`}>
          {label}
        </span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.icon}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
      </div>
      <div className={`text-3xl font-bold ${t.text}`}>{value}</div>
      <div className={`mt-1 text-xs ${t.detail}`}>{detail}</div>
    </div>
  )
}
