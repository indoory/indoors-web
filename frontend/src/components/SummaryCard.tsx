import type { LucideIcon } from 'lucide-react'

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
  tone?: 'slate' | 'sky' | 'emerald' | 'amber' | 'red'
}) {
  const toneMap = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  }

  return (
    <div className="rounded-[28px] border border-white/60 bg-white/85 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <div className={`rounded-2xl border p-2.5 ${toneMap[tone]}`}>
          <Icon className="h-4.5 w-4.5" strokeWidth={2.1} />
        </div>
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-2 text-xs text-slate-500">{detail}</div>
    </div>
  )
}
