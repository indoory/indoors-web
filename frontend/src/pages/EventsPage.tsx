import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { StatusBadge } from '../components/StatusBadge'
import { getEvents, getRobots } from '../lib/api'
import { formatDateTime } from '../lib/utils'

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

  const events = (eventsQuery.data ?? []).filter((event) => {
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

  const eventTypes = Array.from(new Set((eventsQuery.data ?? []).map((event) => event.type)))
  const robots = Array.from(new Set((robotsQuery.data ?? []).map((item) => item.label)))

  return (
    <AppShell
      subtitle="Adapter events, robot warnings, and task lifecycle logs."
      title="Events"
    >
      <div className="rounded-[28px] border border-white/70 bg-white/88 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <input
            className="h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search events..."
            value={search}
          />
          <div className="grid gap-3 sm:grid-cols-3 xl:w-[560px]">
            <select
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
              onChange={(event) => setSeverity(event.target.value)}
              value={severity}
            >
              <option value="ALL">All severity</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
            <select
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
              onChange={(event) => setRobot(event.target.value)}
              value={robot}
            >
              <option value="ALL">All robots</option>
              {robots.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
              onChange={(event) => setType(event.target.value)}
              value={type}
            >
              <option value="ALL">All types</option>
              {eventTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[28px] border border-white/70 bg-white/88 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        {eventsQuery.isLoading ? (
          <div className="p-5">
            <LoadingView compact label="Loading event stream..." />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-5 py-4">Time</th>
                <th className="px-5 py-4">Severity</th>
                <th className="px-5 py-4">Robot</th>
                <th className="px-5 py-4">Type</th>
                <th className="px-5 py-4">Message</th>
                <th className="px-5 py-4">Task</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((event) => (
                <tr className="hover:bg-slate-50/80" key={event.id}>
                  <td className="px-5 py-4 text-slate-500">{formatDateTime(event.createdAt)}</td>
                  <td className="px-5 py-4">
                    <StatusBadge value={event.severity} />
                  </td>
                  <td className="px-5 py-4 text-slate-700">{event.robotLabel ?? 'System'}</td>
                  <td className="px-5 py-4 text-slate-500">{event.type}</td>
                  <td className="px-5 py-4 text-slate-700">{event.message}</td>
                  <td className="px-5 py-4 text-sky-700">{event.taskCode ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}
