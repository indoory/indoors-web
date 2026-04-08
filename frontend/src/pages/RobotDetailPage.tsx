import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { MapCanvas } from '../components/MapCanvas'
import { StatusBadge } from '../components/StatusBadge'
import {
  dispatchRobot,
  emergencyStopRobot,
  getCurrentMap,
  getRobot,
  pauseRobot,
  resumeRobot,
} from '../lib/api'
import { formatDateTime, formatRelativeTime } from '../lib/utils'

export function RobotDetailPage() {
  const { robotId = '' } = useParams()
  const queryClient = useQueryClient()
  const [selectedTab, setSelectedTab] = useState<'commands' | 'events' | 'tasks'>('commands')
  const [dispatchLocationId, setDispatchLocationId] = useState<number | null>(null)
  const [showEstopModal, setShowEstopModal] = useState(false)

  const robotQuery = useQuery({
    queryKey: ['robot', robotId],
    queryFn: () => getRobot(robotId),
    refetchInterval: 4_000,
  })

  const mapQuery = useQuery({
    queryKey: ['map', 'current'],
    queryFn: getCurrentMap,
    refetchInterval: 5_000,
  })

  const robotDetail = robotQuery.data
  const currentMap = mapQuery.data
  const currentFloor = currentMap?.floors.find(
    (floor) => floor.code === robotDetail?.robot.floorCode,
  )
  const dispatchLocations =
    currentFloor?.locations.filter((location) => location.type !== 'CORRIDOR') ?? []
  const selectedDispatchLocationId = dispatchLocationId ?? dispatchLocations[0]?.id ?? null

  const commandMutation = useMutation({
    mutationFn: async (action: 'dispatch' | 'pause' | 'resume' | 'emergency-stop') => {
      if (action === 'dispatch') {
        if (!selectedDispatchLocationId) return
        await dispatchRobot(robotId, { locationId: selectedDispatchLocationId })
        return
      }
      if (action === 'pause') { await pauseRobot(robotId); return }
      if (action === 'resume') { await resumeRobot(robotId); return }
      await emergencyStopRobot(robotId)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['robot', robotId] }),
        queryClient.invalidateQueries({ queryKey: ['robots'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        queryClient.invalidateQueries({ queryKey: ['map', 'current'] }),
      ])
    },
  })

  if (!robotDetail) {
    return (
      <AppShell subtitle="Loading live robot state and control channels." title="Robot Detail">
        <LoadingView compact label="Loading robot detail..." />
      </AppShell>
    )
  }

  const { robot, state, pose, activeTask, commandHistory, events, taskHistory } = robotDetail

  return (
    <AppShell
      subtitle={`${robot.robotCode} · Last updated ${formatRelativeTime(robot.updatedAt)}`}
      title={robot.label}
    >
      {/* Breadcrumb + Status */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link className="flex items-center gap-1 text-sm text-slate-500 transition hover:text-blue-600" to="/robots">
            <ChevronLeft className="h-4 w-4" />
            Robots
          </Link>
          <svg className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-slate-900">{robot.label}</span>
            <StatusBadge value={robot.status} />
            <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              {robot.robotCode}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className={`inline-block h-2 w-2 rounded-full ${state.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          {state.online ? 'Online' : 'Offline'} · Last updated: {formatRelativeTime(state.updatedAt)}
        </div>
      </div>

      {/* Top Row: Info + Map */}
      <div className="mb-6 grid grid-cols-3 gap-6">
        {/* Robot Info Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Robot Information</h2>

          <div className="space-y-0">
            <InfoRow label="Status" value={<StatusBadge value={robot.status} />} />
            <InfoRow
              label="Battery"
              value={
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full ${state.batteryLevel < 20 ? 'bg-red-500' : 'bg-emerald-500'}`}
                      style={{ width: `${state.batteryLevel}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700">{state.batteryLevel}%</span>
                </div>
              }
            />
            <InfoRow label="Floor" value={robot.floorCode} />
            <InfoRow label="Map" value={robot.mapName} />
            <InfoRow label="Environment" value={state.environment} />
            <InfoRow label="Localization" value={state.localizationState} />
          </div>

          {state.warning ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              ⚠ {state.warning}
            </div>
          ) : null}

          {/* Pose summary */}
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <div className="mb-2 text-xs font-medium text-slate-500">Pose</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold text-slate-900">{pose.x.toFixed(2)}</div>
                <div className="text-[10px] uppercase text-slate-400">X (m)</div>
              </div>
              <div>
                <div className="text-lg font-bold text-slate-900">{pose.y.toFixed(2)}</div>
                <div className="text-[10px] uppercase text-slate-400">Y (m)</div>
              </div>
              <div>
                <div className="text-lg font-bold text-slate-900">{pose.yawDeg.toFixed(1)}</div>
                <div className="text-[10px] uppercase text-slate-400">Yaw (°)</div>
              </div>
            </div>
          </div>
        </div>

        {/* Map (2 cols) */}
        <div className="col-span-2">
          {currentMap && currentFloor ? (
            <MapCanvas floor={currentFloor} map={currentMap} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-400">
              No active map available
            </div>
          )}
        </div>
      </div>

      {/* Middle Row: Commands + Current Task */}
      <div className="mb-6 grid grid-cols-3 gap-6">
        {/* Command Panel */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Commands</h2>

          <div className="space-y-3">
            {/* Dispatch */}
            <div className="grid grid-cols-2 gap-2">
              <select
                className="col-span-2 h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onChange={(e) => setDispatchLocationId(Number(e.target.value))}
                value={selectedDispatchLocationId ?? undefined}
              >
                {dispatchLocations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
              <button
                className="col-span-2 flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700"
                onClick={() => commandMutation.mutate('dispatch')}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M3 12h18m-6-6 6 6-6 6" />
                </svg>
                Dispatch
              </button>
            </div>

            {/* Pause / Resume */}
            <div className="grid grid-cols-2 gap-2">
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-500 text-sm font-medium text-white transition hover:bg-amber-600"
                onClick={() => commandMutation.mutate('pause')}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect height="16" width="4" x="6" y="4" /><rect height="16" width="4" x="14" y="4" />
                </svg>
                Pause
              </button>
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-medium text-white transition hover:bg-emerald-700"
                onClick={() => commandMutation.mutate('resume')}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Resume
              </button>
            </div>

            {/* Danger Zone */}
            <div className="border-t border-slate-200 pt-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Danger Zone</div>
              <button
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-red-600 text-sm font-bold text-white ring-2 ring-red-600/30 transition hover:bg-red-700"
                onClick={() => setShowEstopModal(true)}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                  <path d="M12 8v4" /><path d="M12 16h.01" />
                </svg>
                E-STOP
              </button>
            </div>
          </div>
        </div>

        {/* Current Task (2 cols) */}
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Current Task</h2>
            {activeTask ? (
              <Link className="text-xs font-medium text-blue-600 hover:text-blue-700" to="/tasks">
                View details →
              </Link>
            ) : null}
          </div>

          {activeTask ? (
            <div className="flex gap-6">
              <div className="flex-1">
                <div className="grid grid-cols-2 gap-x-8 gap-y-0">
                  <InfoRow label="Task ID" value={<span className="text-sm font-semibold text-blue-600">{activeTask.taskCode}</span>} />
                  <InfoRow label="Status" value={<StatusBadge value={activeTask.status} />} />
                  <InfoRow label="Type" value={activeTask.type} />
                  <InfoRow label="Priority" value={<StatusBadge value={activeTask.priority} />} />
                  <InfoRow label="Pickup" value={activeTask.pickupLocationName} />
                  <InfoRow label="Dropoff" value={activeTask.dropoffLocationName} />
                </div>
              </div>

              {/* Timeline */}
              <div className="w-56 border-l border-slate-200 pl-6">
                <div className="mb-3 text-xs font-medium text-slate-500">Progress</div>
                <div className="space-y-3">
                  {activeTask.timeline.map((step, i) => (
                    <div className="flex items-start gap-3" key={step.key}>
                      <div className="flex flex-col items-center">
                        <div className={`h-3 w-3 rounded-full ring-4 ${
                          step.state === 'done'
                            ? 'bg-emerald-500 ring-emerald-100'
                            : step.state === 'current'
                              ? 'animate-pulse bg-blue-500 ring-blue-100'
                              : 'bg-slate-200 ring-transparent'
                        }`} />
                        {i < activeTask.timeline.length - 1 ? (
                          <div className={`mt-1 h-6 w-0.5 ${step.state === 'done' ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                        ) : null}
                      </div>
                      <div>
                        <div className={`text-xs font-medium ${step.state === 'current' ? 'text-blue-600' : 'text-slate-700'}`}>
                          {step.label}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {step.timestamp ? formatDateTime(step.timestamp) : step.state === 'current' ? 'In progress...' : 'Pending'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              No active task is assigned to this robot.
            </div>
          )}
        </div>
      </div>

      {/* History Tabs */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex border-b border-slate-200">
          {([
            ['commands', 'Command History'],
            ['events', 'Events'],
            ['tasks', 'Task History'],
          ] as const).map(([key, label]) => (
            <button
              className={`px-5 py-3 text-sm font-medium transition ${
                selectedTab === key
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              key={key}
              onClick={() => setSelectedTab(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {selectedTab === 'commands' ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Time</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Command</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Parameters</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Issued By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {commandHistory.map((cmd) => (
                  <tr className="hover:bg-slate-50" key={cmd.id}>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{formatDateTime(cmd.createdAt)}</td>
                    <td className="px-5 py-2.5">
                      <StatusBadge value={cmd.commandType} />
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">{cmd.parameters || '--'}</td>
                    <td className="px-5 py-2.5">
                      <StatusBadge value={cmd.status} />
                    </td>
                    <td className="px-5 py-2.5 text-slate-500">{cmd.issuedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {selectedTab === 'events' ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Time</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Severity</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Type</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {events.map((event) => (
                  <tr className="hover:bg-slate-50" key={event.id}>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{formatDateTime(event.createdAt)}</td>
                    <td className="px-5 py-2.5"><StatusBadge value={event.severity} /></td>
                    <td className="px-5 py-2.5 text-slate-500">{event.type}</td>
                    <td className="px-5 py-2.5 text-slate-700">{event.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {selectedTab === 'tasks' ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Task</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Route</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Created</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {taskHistory.map((task) => (
                  <tr className="hover:bg-slate-50" key={task.id}>
                    <td className="px-5 py-2.5 font-medium text-blue-600">{task.taskCode}</td>
                    <td className="px-5 py-2.5"><StatusBadge value={task.status} /></td>
                    <td className="px-5 py-2.5 text-slate-600">
                      {task.pickupLocationName} <ArrowRight className="mx-1 inline h-3 w-3" /> {task.dropoffLocationName}
                    </td>
                    <td className="px-5 py-2.5 text-slate-500">{formatDateTime(task.createdAt)}</td>
                    <td className="px-5 py-2.5 text-slate-500">{task.completedAt ? formatDateTime(task.completedAt) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      {/* E-STOP Modal */}
      {showEstopModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowEstopModal(false)}
          />
          <div className="relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                <svg className="h-7 w-7 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                  <path d="M12 8v4" /><path d="M12 16h.01" />
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-bold text-slate-900">Emergency Stop</h3>
              <p className="mb-6 text-sm text-slate-500">
                Are you sure you want to perform an{' '}
                <strong className="text-red-600">emergency stop</strong> on{' '}
                <strong>{robot.label}</strong>? This will immediately halt all movement and cancel the current task.
              </p>
              <div className="flex gap-3">
                <button
                  className="flex-1 h-11 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  onClick={() => setShowEstopModal(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="flex-1 h-11 rounded-lg bg-red-600 text-sm font-bold text-white transition hover:bg-red-700"
                  onClick={() => {
                    commandMutation.mutate('emergency-stop')
                    setShowEstopModal(false)
                  }}
                  type="button"
                >
                  Confirm E-STOP
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-700">{value}</span>
    </div>
  )
}
