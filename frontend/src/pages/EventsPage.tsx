import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { StatusBadge } from '../components/StatusBadge'
import { getEvents, getRobots } from '../lib/api'
import { formatDateTime, isToday } from '../lib/utils'

export function EventsPage() {
  const eventsQuery = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
    refetchInterval: 5_000,
  })
  const robotsQuery = useQuery({
    queryKey: ['robots'],
    queryFn: getRobots,
    refetchInterval: 5_000,
  })

  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('ALL')
  const [robot, setRobot] = useState('ALL')
  const [type, setType] = useState('ALL')
  const deferredSearch = useDeferredValue(search)

  const allEvents = eventsQuery.data ?? []
  const events = allEvents.filter((event) => {
    const searchValue = deferredSearch.toLowerCase()
    const matchesSearch =
      event.message.toLowerCase().includes(searchValue) ||
      event.type.toLowerCase().includes(searchValue) ||
      (event.robotLabel ?? '').toLowerCase().includes(searchValue)
    const matchesSeverity = severity === 'ALL' || event.severity === severity
    const matchesRobot = robot === 'ALL' || event.robotLabel === robot
    const matchesType = type === 'ALL' || event.type === type
    return matchesSearch && matchesSeverity && matchesRobot && matchesType
  })

  const todayEvents = allEvents.filter((e) => isToday(e.createdAt))
  const infoCount = todayEvents.filter((e) => e.severity === 'INFO').length
  const warnCount = todayEvents.filter((e) => e.severity === 'WARN').length
  const errorCount = todayEvents.filter((e) => e.severity === 'ERROR').length
  const criticalCount = todayEvents.filter((e) => e.severity === 'CRITICAL').length

  const eventTypes = Array.from(new Set(allEvents.map((event) => event.type)))
  const robots = Array.from(new Set((robotsQuery.data ?? []).map((item) => item.label)))

  return (
    <AppShell
      subtitle={`${allEvents.length} events total`}
      title="Events"
    >
      {/* Severity Summary Cards */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
            <span className="text-lg font-bold text-blue-600">{infoCount}</span>
          </div>
          <div>
            <div className="text-xs text-slate-500">INFO</div>
            <div className="text-sm font-medium text-slate-700">Today</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
            <span className="text-lg font-bold text-amber-600">{warnCount}</span>
          </div>
          <div>
            <div className="text-xs font-medium text-amber-600">WARN</div>
            <div className="text-sm font-medium text-slate-700">Today</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
            <span className="text-lg font-bold text-red-600">{errorCount}</span>
          </div>
          <div>
            <div className="text-xs font-medium text-red-600">ERROR</div>
            <div className="text-sm font-medium text-slate-700">Today</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-red-300 bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
            <span className="text-lg font-bold text-red-700">{criticalCount}</span>
          </div>
          <div>
            <div className="text-xs font-medium text-red-700">CRITICAL</div>
            <div className="text-sm font-medium text-slate-700">Today</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
              value={search}
            />
          </div>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setSeverity(e.target.value)}
            value={severity}
          >
            <option value="ALL">All Severity</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setRobot(e.target.value)}
            value={robot}
          >
            <option value="ALL">All Robots</option>
            {robots.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setType(e.target.value)}
            value={type}
          >
            <option value="ALL">All Types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Event Log Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {eventsQuery.isLoading ? (
          <div className="p-5">
            <LoadingView compact label="Loading event stream..." />
          </div>
        ) : null}

        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="w-40 px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Time</th>
              <th className="w-24 px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Severity</th>
              <th className="w-28 px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Robot</th>
              <th className="w-28 px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Type</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Message</th>
              <th className="w-28 px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Task</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {events.map((event) => {
              const borderColor =
                event.severity === 'CRITICAL' ? 'border-l-red-600' :
                event.severity === 'ERROR' ? 'border-l-red-500' :
                event.severity === 'WARN' ? 'border-l-amber-400' : 'border-l-blue-400'
              const bgColor =
                event.severity === 'CRITICAL' || event.severity === 'ERROR'
                  ? 'bg-red-50/30'
                  : event.severity === 'WARN'
                    ? 'bg-amber-50/20'
                    : ''
              return (
                <tr className={`border-l-4 ${borderColor} ${bgColor} hover:bg-opacity-50`} key={event.id}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{formatDateTime(event.createdAt)}</td>
                  <td className="px-5 py-3"><StatusBadge value={event.severity} /></td>
                  <td className="px-5 py-3 font-medium text-slate-700">{event.robotLabel ?? 'System'}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {event.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-700">{event.message}</td>
                  <td className="px-5 py-3 font-medium text-blue-600">{event.taskCode ?? '--'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <span className="text-sm text-slate-500">Showing {events.length} of {allEvents.length} events</span>
        </div>
      </div>
    </AppShell>
  )
}
