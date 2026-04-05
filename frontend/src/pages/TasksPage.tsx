import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
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

  const tasks = (tasksQuery.data ?? []).filter((task) => {
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
    new Set((tasksQuery.data ?? []).map((task) => task.assignedRobotLabel).filter(Boolean)),
  )
  const floors = Array.from(new Set((tasksQuery.data ?? []).map((task) => task.floorCode)))
  const created = searchParams.get('created')

  return (
    <AppShell
      subtitle="Live task queue, assignment state, and completed delivery history."
      title="Tasks"
    >
      {created ? (
        <div className="mb-6 rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
          Task <strong>{created}</strong> was created and routed through the auto-dispatch flow.
        </div>
      ) : null}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="rounded-[28px] border border-white/70 bg-white/88 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] xl:flex-1">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <input
              className="h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks..."
              value={search}
            />
            <div className="grid gap-3 sm:grid-cols-3 xl:w-[560px]">
              <select
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value="ALL">All status</option>
                <option value="CREATED">CREATED</option>
                <option value="ASSIGNED">ASSIGNED</option>
                <option value="RUNNING">RUNNING</option>
                <option value="PAUSED">PAUSED</option>
                <option value="DONE">DONE</option>
                <option value="CANCELED">CANCELED</option>
                <option value="FAILED">FAILED</option>
              </select>
              <select
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-sky-400"
                onChange={(event) => setRobot(event.target.value)}
                value={robot}
              >
                <option value="ALL">All robots</option>
                {robots.map((item) => (
                  <option key={item} value={item ?? 'ALL'}>
                    {item}
                  </option>
                ))}
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
            </div>
          </div>
        </div>

        <Link
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-700"
          to="/tasks/new"
        >
          <Plus className="h-4 w-4" />
          New task
        </Link>
      </div>

      <div className="mt-6 rounded-[28px] border border-white/70 bg-white/88 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        {tasksQuery.isLoading ? (
          <div className="p-5">
            <LoadingView compact label="Loading task list..." />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-5 py-4">Task</th>
                <th className="px-5 py-4">Robot</th>
                <th className="px-5 py-4">Type</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Priority</th>
                <th className="px-5 py-4">Floor</th>
                <th className="px-5 py-4">Pickup → Dropoff</th>
                <th className="px-5 py-4">Created</th>
                <th className="px-5 py-4">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <tr className="hover:bg-slate-50/80" key={task.id}>
                  <td className="px-5 py-4 font-semibold text-sky-700">{task.taskCode}</td>
                  <td className="px-5 py-4 text-slate-700">{task.assignedRobotLabel ?? 'Queued'}</td>
                  <td className="px-5 py-4 text-slate-500">{task.type}</td>
                  <td className="px-5 py-4">
                    <StatusBadge value={task.status} />
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge value={task.priority} />
                  </td>
                  <td className="px-5 py-4 text-slate-500">{task.floorCode}</td>
                  <td className="px-5 py-4 text-slate-600">
                    {task.pickupLocationName} → {task.dropoffLocationName}
                  </td>
                  <td className="px-5 py-4 text-slate-500">{formatDateTime(task.createdAt)}</td>
                  <td className="px-5 py-4 text-slate-500">{formatDateTime(task.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}
