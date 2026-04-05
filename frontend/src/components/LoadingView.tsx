export function LoadingView({ label = 'Loading data...', compact = false }: { label?: string; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-500">
        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-6">
      <div className="rounded-[32px] border border-white/70 bg-white/85 px-8 py-7 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-sky-500" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Indoory</div>
            <div className="mt-1 text-sm text-slate-500">{label}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
