import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bot, CheckCheck, Gauge, ListTodo, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { StatusBadge } from '../components/StatusBadge'
import { SummaryCard } from '../components/SummaryCard'
import { getEvents, getRobots, getTasks } from '../lib/api'
import { formatDateTime, formatRelativeTime, isToday } from '../lib/utils'

export function DashboardPage() {
  const robotsQuery = useQuery({
    queryKey: ['robots'],
    queryFn: getRobots,
    refetchInterval: 5_000,
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: getTasks,
    refetchInterval: 5_000,
  })
  const eventsQuery = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
    refetchInterval: 5_000,
  })

  const robots = robotsQuery.data ?? []
  const tasks = tasksQuery.data ?? []
  const events = eventsQuery.data ?? []

  const activeTasks = tasks.filter((task) => ['ASSIGNED', 'RUNNING', 'PAUSED'].includes(task.status))
  const queuedTasks = tasks.filter((task) => task.status === 'CREATED')
  const errorRobots = robots.filter(
    (robot) => robot.status === 'ERROR' || robot.status === 'EMERGENCY_STOP',
  )
  const lowBatteryRobots = robots.filter((robot) => robot.batteryLevel < 20)
  const onlineRobots = robots.filter((robot) => robot.online)
  const completedToday = tasks.filter((task) => task.status === 'DONE' && isToday(task.completedAt)).length

  return (
    <AppShell
      subtitle="Fleet overview and real-time status"
      title="Dashboard"
    >
      {robotsQuery.isLoading || tasksQuery.isLoading || eventsQuery.isLoading ? (
        <LoadingView compact label="Loading dashboard..." />
      ) : null}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          detail={`${onlineRobots.length} online · ${robots.length - onlineRobots.length} offline`}
          icon={Bot}
          label="Total Robots"
          tone="sky"
          value={robots.length}
        />
        <SummaryCard
          detail={`${activeTasks.filter((t) => t.status === 'RUNNING').length} running`}
          icon={Gauge}
          label="Active Tasks"
          tone="emerald"
          value={activeTasks.length}
        />
        <SummaryCard
          detail={errorRobots.map((r) => r.label).join(', ') || 'No faults'}
          icon={ShieldAlert}
          label="Errors"
          tone={errorRobots.length ? 'red' : 'slate'}
          value={errorRobots.length}
        />
        <SummaryCard
          detail={lowBatteryRobots.map((r) => `${r.label} (${r.batteryLevel}%)`).join(', ') || 'Healthy fleet'}
          icon={AlertTriangle}
          label="Low Battery"
          tone={lowBatteryRobots.length ? 'amber' : 'slate'}
          value={lowBatteryRobots.length}
        />
        <SummaryCard
          detail={queuedTasks.length ? 'Waiting for auto dispatch' : 'No tasks waiting'}
          icon={ListTodo}
          label="Queued Tasks"
          tone={queuedTasks.length ? 'amber' : 'slate'}
          value={queuedTasks.length}
        />
        <SummaryCard
          detail="Completed since midnight"
          icon={CheckCheck}
          label="Delivered Today"
          tone="slate"
          value={completedToday}
        />
      </div>

      {/* Robot Fleet + Recent Events */}
      <div className="mt-6 grid grid-cols-3 gap-6">
        {/* Robot Fleet Status */}
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Robot Fleet Status</h2>
            <Link className="text-xs font-medium text-blue-600 hover:text-blue-700" to="/robots">
              View all →
            </Link>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-3">
              {robots.slice(0, 6).map((robot) => (
                <Link
                  className={`block cursor-pointer rounded-lg border p-4 transition hover:shadow-sm ${
                    robot.status === 'ERROR' || robot.status === 'EMERGENCY_STOP'
                      ? 'border-red-200 bg-red-50/50 hover:border-red-300'
                      : robot.batteryLevel < 20
                        ? 'border-amber-200 bg-amber-50/30 hover:border-amber-300'
                        : 'border-slate-200 hover:border-blue-300'
                  }`}
                  key={robot.id}
                  to={`/robots/${robot.id}`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{robot.label}</span>
                    <StatusBadge value={robot.status} />
                  </div>
                  <div className="space-y-2 text-xs text-slate-500">
                    <div className="flex items-center justify-between">
                      <span>Battery</span>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-16 rounded-full bg-slate-100">
                          <div
                            className={`h-1.5 rounded-full ${robot.batteryLevel < 20 ? 'bg-red-500' : 'bg-emerald-500'}`}
                            style={{ width: `${robot.batteryLevel}%` }}
                          />
                        </div>
                        <span className={`font-medium ${robot.batteryLevel < 20 ? 'text-red-600' : 'text-slate-700'}`}>
                          {robot.batteryLevel}%
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span>Floor</span>
                      <span className="font-medium text-slate-700">{robot.floorCode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Task</span>
                      <span className={robot.currentTaskCode ? 'font-medium text-blue-600' : 'text-slate-400'}>
                        {robot.currentTaskCode ?? 'None'}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Events */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Recent Events</h2>
            <Link className="text-xs font-medium text-blue-600 hover:text-blue-700" to="/events">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {events.slice(0, 6).map((event) => {
              const borderColor =
                event.severity === 'ERROR' || event.severity === 'CRITICAL'
                  ? 'border-l-red-500'
                  : event.severity === 'WARN'
                    ? 'border-l-amber-400'
                    : 'border-l-blue-400'
              const bgColor =
                event.severity === 'ERROR' || event.severity === 'CRITICAL'
                  ? 'bg-red-50/50'
                  : ''
              return (
                <div className={`border-l-4 px-5 py-3 ${borderColor} ${bgColor}`} key={event.id}>
                  <div className="mb-1 flex items-center gap-2">
                    <StatusBadge value={event.severity} />
                    <span className="text-xs text-slate-400">{formatRelativeTime(event.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-700">{event.message}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {event.robotLabel ?? 'System'} · {event.type}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent Tasks */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent Tasks</h2>
          <Link className="text-xs font-medium text-blue-600 hover:text-blue-700" to="/tasks">
            View all →
          </Link>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Task ID</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Robot</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Route</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.slice(0, 5).map((task) => (
              <tr className="hover:bg-slate-50" key={task.id}>
                <td className="px-5 py-3 text-sm font-semibold text-blue-600">{task.taskCode}</td>
                <td className="px-5 py-3 text-sm text-slate-700">{task.assignedRobotLabel ?? 'Queued'}</td>
                <td className="px-5 py-3">
                  <StatusBadge value={task.status} />
                </td>
                <td className="px-5 py-3 text-sm text-slate-600">
                  {task.pickupLocationName} → {task.dropoffLocationName}
                </td>
                <td className="px-5 py-3 text-sm text-slate-400">{formatDateTime(task.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  )
}
