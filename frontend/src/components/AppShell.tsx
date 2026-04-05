import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Bot,
  LayoutDashboard,
  LogOut,
  Map,
  ShieldCheck,
  SquareCheckBig,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { logout } from '../lib/api'
import { cn, initials } from '../lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/robots', label: 'Robots', icon: Bot },
  { to: '/tasks', label: 'Tasks', icon: SquareCheckBig },
  { to: '/maps', label: 'Maps', icon: Map },
  { to: '/events', label: 'Events', icon: Activity },
]

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  const session = useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  const operator = session.data

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] px-4 py-5 md:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-200">
              Indoory
            </div>
            <div className="mt-1 text-xs text-slate-400">Indoor robot control</div>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition',
                  isActive
                    ? 'bg-white text-slate-950 shadow-[0_20px_40px_rgba(15,23,42,0.18)]'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                )
              }
              to={to}
            >
              <Icon className="h-4.5 w-4.5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto rounded-[28px] border border-slate-700/70 bg-slate-800/70 p-4 text-sm text-slate-300">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            Simulated ROS adapter
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Web control commands are routed through the Java backend adapter and replayed
            with seeded robot telemetry.
          </p>
        </div>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 border-b border-white/70 bg-white/70 backdrop-blur">
          <div className="mx-auto max-w-[1500px] px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  Indoory Control
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
                <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
              </div>

              <div className="flex items-center justify-between gap-4 lg:justify-end">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-700">
                  Backend adapter online
                </div>
                <div className="flex items-center gap-3 rounded-[24px] border border-slate-200 bg-white/90 px-3 py-2 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                    {initials(operator?.name ?? 'IO')}
                  </div>
                  <div className="hidden sm:block">
                    <div className="text-sm font-semibold text-slate-900">{operator?.name ?? 'Operator'}</div>
                    <div className="text-xs text-slate-500">{operator?.role ?? 'ADMIN'}</div>
                  </div>
                  <button
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                    onClick={() => logoutMutation.mutate()}
                    type="button"
                  >
                    <span className="inline-flex items-center gap-2">
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {navItems.map(({ to, label }) => (
                <NavLink
                  key={to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-full border px-4 py-2 text-sm font-medium transition',
                      isActive
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : 'border-slate-200 bg-white text-slate-600',
                    )
                  }
                  to={to}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  )
}
