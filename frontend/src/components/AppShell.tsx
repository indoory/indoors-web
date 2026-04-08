import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Bot,
  LayoutDashboard,
  LogOut,
  Map,
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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-800 bg-slate-900 text-slate-400 md:flex">
        {/* Logo */}
        <div className="flex h-14 items-center border-b border-slate-800 px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">Indoory</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-white',
                )
              }
              to={to}
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* System status */}
        <div className="border-t border-slate-800 px-3 py-4">
          <div className="flex items-center gap-2 px-3 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            System Online
          </div>
        </div>
      </aside>

      <div className="md:pl-60">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
          </div>

          <div className="flex items-center gap-4">
            {/* Operator profile */}
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
                {initials(operator?.name ?? 'IO')}
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-medium text-slate-700">{operator?.name ?? 'Operator'}</div>
                <div className="text-xs text-slate-400">{operator?.role ?? 'ADMIN'}</div>
              </div>
              <button
                className="ml-1 rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                onClick={() => logoutMutation.mutate()}
                title="Sign out"
                type="button"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 md:hidden">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                  isActive
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600',
                )
              }
              to={to}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
