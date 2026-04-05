import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { StatusBadge } from '../components/StatusBadge'
import { getRobots } from '../lib/api'
import { formatRelativeTime } from '../lib/utils'

export function RobotsPage() {
  const robotsQuery = useQuery({
    queryKey: ['robots'],
    queryFn: getRobots,
    refetchInterval: 5_000,
  })

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [floor, setFloor] = useState('ALL')
  const [connectivity, setConnectivity] = useState('ALL')
  const deferredSearch = useDeferredValue(search)

  const robots = (robotsQuery.data ?? []).filter((robot) => {
    const matchesSearch =
      robot.label.toLowerCase().includes(deferredSearch.toLowerCase()) ||
      robot.robotCode.toLowerCase().includes(deferredSearch.toLowerCase())
    const matchesStatus = status === 'ALL' || robot.status === status
    const matchesFloor = floor === 'ALL' || robot.floorCode === floor
    const matchesConnectivity =
      connectivity === 'ALL' ||
      (connectivity === 'ONLINE' && robot.online) ||
      (connectivity === 'OFFLINE' && !robot.online)

    return matchesSearch && matchesStatus && matchesFloor && matchesConnectivity
  })

  const floors = Array.from(new Set((robotsQuery.data ?? []).map((robot) => robot.floorCode)))

  return (
    <AppShell
      subtitle="Realtime robot list with fleet status, battery, and active task linkage."
      title="Robots"
    >
      <div className="rounded-[28px] border border-white/70 bg-white/88 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <input
            className="h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search robots..."
            value={search}
          />
          <div className="grid gap-3 sm:grid-cols-3 xl:w-[560px]">
            <select
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="ALL">All status</option>
              <option value="IDLE">IDLE</option>
              <option value="NAVIGATING">NAVIGATING</option>
              <option value="PLANNING">PLANNING</option>
              <option value="PAUSED">PAUSED</option>
              <option value="ERROR">ERROR</option>
              <option value="EMERGENCY_STOP">EMERGENCY_STOP</option>
              <option value="OFFLINE">OFFLINE</option>
            </select>
            <select
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
              onChange={(event) => setFloor(event.target.value)}
              value={floor}
            >
              <option value="ALL">All floors</option>
              {floors.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
              onChange={(event) => setConnectivity(event.target.value)}
              value={connectivity}
            >
              <option value="ALL">All connectivity</option>
              <option value="ONLINE">Online only</option>
              <option value="OFFLINE">Offline only</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[28px] border border-white/70 bg-white/88 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        {robotsQuery.isLoading ? (
          <div className="p-5">
            <LoadingView compact label="Loading robot roster..." />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-5 py-4">Robot</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Floor</th>
                <th className="px-5 py-4">Map</th>
                <th className="px-5 py-4">Battery</th>
                <th className="px-5 py-4">Current Task</th>
                <th className="px-5 py-4">Online</th>
                <th className="px-5 py-4">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {robots.map((robot) => (
                <tr className="hover:bg-slate-50/80" key={robot.id}>
                  <td className="px-5 py-4">
                    <Link className="block" to={`/robots/${robot.id}`}>
                      <div className="font-semibold text-slate-950">{robot.label}</div>
                      <div className="mt-1 text-xs text-slate-400">{robot.robotCode}</div>
                    </Link>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge value={robot.status} />
                  </td>
                  <td className="px-5 py-4 text-slate-700">{robot.floorCode}</td>
                  <td className="px-5 py-4 text-slate-500">{robot.mapName}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${robot.batteryLevel}%` }}
                        />
                      </div>
                      <span className="text-slate-700">{robot.batteryLevel}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sky-700">{robot.currentTaskCode ?? '--'}</td>
                  <td className="px-5 py-4">
                    <span className={robot.online ? 'text-emerald-600' : 'text-slate-400'}>
                      {robot.online ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-500">{formatRelativeTime(robot.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}
