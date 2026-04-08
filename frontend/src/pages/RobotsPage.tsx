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

  const allRobots = robotsQuery.data ?? []
  const robots = allRobots.filter((robot) => {
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

  const floors = Array.from(new Set(allRobots.map((robot) => robot.floorCode)))

  return (
    <AppShell
      subtitle={`${allRobots.length} robots registered`}
      title="Robots"
    >
      {/* Filter Toolbar */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search robots..."
              value={search}
            />
          </div>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setStatus(e.target.value)}
            value={status}
          >
            <option value="ALL">All Status</option>
            <option value="IDLE">IDLE</option>
            <option value="NAVIGATING">NAVIGATING</option>
            <option value="PLANNING">PLANNING</option>
            <option value="PAUSED">PAUSED</option>
            <option value="ERROR">ERROR</option>
            <option value="EMERGENCY_STOP">EMERGENCY_STOP</option>
            <option value="OFFLINE">OFFLINE</option>
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setFloor(e.target.value)}
            value={floor}
          >
            <option value="ALL">All Floors</option>
            {floors.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setConnectivity(e.target.value)}
            value={connectivity}
          >
            <option value="ALL">All</option>
            <option value="ONLINE">Online only</option>
            <option value="OFFLINE">Offline only</option>
          </select>
          <div className="ml-auto flex items-center">
            <Link
              className="flex items-center gap-2 h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
              to="/robots/new"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
              Create Robot
            </Link>
          </div>
        </div>
      </div>

      {/* Robot Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {robotsQuery.isLoading ? (
          <div className="p-5">
            <LoadingView compact label="Loading robot roster..." />
          </div>
        ) : null}

        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Robot</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Floor</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Map</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Battery</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Current Task</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Online</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Last Updated</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {robots.map((robot) => (
              <tr
                className={`cursor-pointer ${
                  robot.status === 'ERROR' || robot.status === 'EMERGENCY_STOP'
                    ? 'bg-red-50/30 hover:bg-red-50/50'
                    : robot.batteryLevel < 20 && robot.online
                      ? 'bg-amber-50/30 hover:bg-slate-50'
                      : robot.online
                        ? 'hover:bg-slate-50'
                        : 'opacity-50 hover:bg-slate-50'
                }`}
                key={robot.id}
              >
                <td className="px-5 py-3">
                  <Link className="flex items-center gap-3" to={`/robots/${robot.id}`}>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      robot.status === 'ERROR' || robot.status === 'EMERGENCY_STOP'
                        ? 'bg-red-50'
                        : robot.batteryLevel < 20 && robot.online
                          ? 'bg-amber-50'
                          : robot.online
                            ? 'bg-blue-50'
                            : 'bg-slate-100'
                    }`}>
                      <svg className={`h-5 w-5 ${
                        robot.status === 'ERROR' || robot.status === 'EMERGENCY_STOP'
                          ? 'text-red-600'
                          : robot.batteryLevel < 20 && robot.online
                            ? 'text-amber-600'
                            : robot.online
                              ? 'text-blue-600'
                              : 'text-slate-400'
                      }`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <rect height="10" rx="2" width="18" x="3" y="11" />
                        <circle cx="12" cy="5" r="2" />
                        <path d="M12 7v4" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{robot.label}</div>
                      <div className="text-xs text-slate-400">{robot.robotCode}</div>
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <StatusBadge value={robot.status} />
                </td>
                <td className="px-5 py-3 text-sm text-slate-700">{robot.online ? robot.floorCode : '--'}</td>
                <td className="px-5 py-3 text-sm text-slate-500">{robot.online ? robot.mapName : '--'}</td>
                <td className="px-5 py-3">
                  {robot.online ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-slate-100">
                        <div
                          className={`h-1.5 rounded-full ${robot.batteryLevel < 20 ? 'bg-red-500' : 'bg-emerald-500'}`}
                          style={{ width: `${robot.batteryLevel}%` }}
                        />
                      </div>
                      <span className={`text-sm ${robot.batteryLevel < 20 ? 'font-medium text-red-600' : 'text-slate-700'}`}>
                        {robot.batteryLevel}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">--</span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm font-medium text-blue-600">
                  {robot.currentTaskCode ?? <span className="text-slate-400">--</span>}
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${robot.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                </td>
                <td className="px-5 py-3 text-sm text-slate-400">{formatRelativeTime(robot.updatedAt)}</td>
                <td className="px-5 py-3">
                  <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <span className="text-sm text-slate-500">
            Showing {robots.length} of {allRobots.length} robots
          </span>
        </div>
      </div>
    </AppShell>
  )
}
