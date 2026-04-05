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
      subtitle="Live fleet overview, queue pressure, and recent control events."
      title="Dashboard"
    >
      {robotsQuery.isLoading || tasksQuery.isLoading || eventsQuery.isLoading ? (
        <LoadingView compact label="Preparing live dashboard widgets..." />
      ) : null}

      <section className="grid gap-4 md:grid-cols-3 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard
          detail={`${onlineRobots.length} online · ${robots.length - onlineRobots.length} offline`}
          icon={Bot}
          label="Total Robots"
          tone="sky"
          value={robots.length}
        />
        <SummaryCard
          detail={`${activeTasks.filter((task) => task.status === 'RUNNING').length} running`}
          icon={Gauge}
          label="Active Tasks"
          tone="emerald"
          value={activeTasks.length}
        />
        <SummaryCard
          detail={errorRobots.map((robot) => robot.label).join(', ') || 'No faults'}
          icon={ShieldAlert}
          label="Errors"
          tone={errorRobots.length ? 'red' : 'slate'}
          value={errorRobots.length}
        />
        <SummaryCard
          detail={lowBatteryRobots.map((robot) => `${robot.label} ${robot.batteryLevel}%`).join(', ') || 'Healthy fleet'}
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
          detail="Completed since local midnight"
          icon={CheckCheck}
          label="Completed Today"
          tone="slate"
          value={completedToday}
        />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Robot fleet status</h2>
              <p className="mt-1 text-xs text-slate-500">Realtime robot status and active task pairing.</p>
            </div>
            <Link className="text-sm font-medium text-sky-700" to="/robots">
              View all
            </Link>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {robots.slice(0, 6).map((robot) => (
              <Link
                className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-sky-300 hover:bg-white"
                key={robot.id}
                to={`/robots/${robot.id}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{robot.label}</div>
                    <div className="mt-1 text-xs text-slate-400">{robot.robotCode}</div>
                  </div>
                  <StatusBadge value={robot.status} />
                </div>
                <div className="mt-4 space-y-2 text-xs text-slate-500">
                  <div className="flex items-center justify-between">
                    <span>Battery</span>
                    <span className="font-medium text-slate-700">{robot.batteryLevel}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${robot.batteryLevel}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Floor</span>
                    <span className="font-medium text-slate-700">{robot.floorCode}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Current Task</span>
                    <span className="font-medium text-slate-700">{robot.currentTaskCode ?? '--'}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Recent events</h2>
              <p className="mt-1 text-xs text-slate-500">The latest fleet, task, and adapter events.</p>
            </div>
            <Link className="text-sm font-medium text-sky-700" to="/events">
              View all
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {events.slice(0, 6).map((event) => (
              <div
                className="rounded-3xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                key={event.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge value={event.severity} />
                  <span className="text-xs text-slate-400">{formatRelativeTime(event.createdAt)}</span>
                </div>
                <div className="mt-3 text-sm font-medium text-slate-900">{event.message}</div>
                <div className="mt-2 text-xs text-slate-500">
                  {(event.robotLabel ?? 'System') + ' · ' + event.type}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Recent tasks</h2>
            <p className="mt-1 text-xs text-slate-500">Auto-dispatched and queued work across the building.</p>
          </div>
          <Link className="text-sm font-medium text-sky-700" to="/tasks">
            Open task list
          </Link>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Robot</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.slice(0, 6).map((task) => (
                <tr className="hover:bg-slate-50/80" key={task.id}>
                  <td className="px-4 py-3 font-semibold text-sky-700">{task.taskCode}</td>
                  <td className="px-4 py-3 text-slate-700">{task.assignedRobotLabel ?? 'Queued'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={task.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {task.pickupLocationName} → {task.dropoffLocationName}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(task.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  )
}
