import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { StatusBadge } from '../components/StatusBadge'
import { getTasks } from '../lib/api'
import { formatDateTime } from '../lib/utils'

export function TasksPage() {
  const [searchParams] = useSearchParams()
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: getTasks,
    refetchInterval: 5_000,
  })

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [robot, setRobot] = useState('ALL')
  const [floor, setFloor] = useState('ALL')
  const deferredSearch = useDeferredValue(search)

  const allTasks = tasksQuery.data ?? []
  const tasks = allTasks.filter((task) => {
    const matchesSearch =
      task.taskCode.toLowerCase().includes(deferredSearch.toLowerCase()) ||
      task.pickupLocationName.toLowerCase().includes(deferredSearch.toLowerCase()) ||
      task.dropoffLocationName.toLowerCase().includes(deferredSearch.toLowerCase())
    const matchesStatus = status === 'ALL' || task.status === status
    const matchesRobot = robot === 'ALL' || task.assignedRobotLabel === robot
    const matchesFloor = floor === 'ALL' || task.floorCode === floor
    return matchesSearch && matchesStatus && matchesRobot && matchesFloor
  })

  const robots = Array.from(
    new Set(allTasks.map((task) => task.assignedRobotLabel).filter(Boolean)),
  )
  const floors = Array.from(new Set(allTasks.map((task) => task.floorCode)))
  const created = searchParams.get('created')

  return (
    <AppShell
      subtitle={`${allTasks.length} total tasks`}
      title="Tasks"
    >
      {created ? (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Task <strong>{created}</strong> was created and routed through the auto-dispatch flow.
        </div>
      ) : null}

      {/* Action Bar */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="h-9 w-72 rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              value={search}
            />
          </div>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setStatus(e.target.value)}
            value={status}
          >
            <option value="ALL">All Status</option>
            <option value="CREATED">CREATED</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="RUNNING">RUNNING</option>
            <option value="PAUSED">PAUSED</option>
            <option value="DONE">DONE</option>
            <option value="CANCELED">CANCELED</option>
            <option value="FAILED">FAILED</option>
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setRobot(e.target.value)}
            value={robot}
          >
            <option value="ALL">All Robots</option>
            {robots.map((r) => (
              <option key={r} value={r ?? ''}>{r}</option>
            ))}
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
        </div>
        <Link
          className="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700"
          to="/tasks/new"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14m-7-7h14" />
          </svg>
          New Task
        </Link>
      </div>

      {/* Task Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {tasksQuery.isLoading ? (
          <div className="p-5">
            <LoadingView compact label="Loading task list..." />
          </div>
        ) : null}

        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Task ID</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Robot</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Type</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Priority</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Floor</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Pickup → Dropoff</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Created</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map((task) => (
              <tr
                className={`cursor-pointer hover:bg-slate-50 ${task.status === 'FAILED' ? 'bg-red-50/30' : ''}`}
                key={task.id}
              >
                <td className="px-5 py-3 text-sm font-semibold text-blue-600">{task.taskCode}</td>
                <td className="px-5 py-3 text-sm text-slate-700">{task.assignedRobotLabel ?? 'Queued'}</td>
                <td className="px-5 py-3 text-sm text-slate-500">{task.type}</td>
                <td className="px-5 py-3"><StatusBadge value={task.status} /></td>
                <td className="px-5 py-3"><StatusBadge value={task.priority} /></td>
                <td className="px-5 py-3 text-sm text-slate-500">{task.floorCode}</td>
                <td className="px-5 py-3 text-sm text-slate-600">
                  {task.pickupLocationName} → {task.dropoffLocationName}
                </td>
                <td className="px-5 py-3 text-sm text-slate-400">{formatDateTime(task.createdAt)}</td>
                <td className="px-5 py-3 text-sm text-slate-400">
                  {task.completedAt ? formatDateTime(task.completedAt) : '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <span className="text-sm text-slate-500">Showing {tasks.length} of {allTasks.length} tasks</span>
        </div>
      </div>
    </AppShell>
  )
}
