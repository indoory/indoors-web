import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Pause, Play, Radio, Route, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
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
import { formatDateTime, formatRelativeTime, toTitle } from '../lib/utils'

export function RobotDetailPage() {
  const { robotId = '' } = useParams()
  const queryClient = useQueryClient()
  const [selectedTab, setSelectedTab] = useState<'commands' | 'events' | 'tasks' | 'logs'>('commands')
  const [dispatchLocationId, setDispatchLocationId] = useState<number | null>(null)

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
        if (!selectedDispatchLocationId) {
          return
        }
        await dispatchRobot(robotId, { locationId: selectedDispatchLocationId })
        return
      }

      if (action === 'pause') {
        await pauseRobot(robotId)
        return
      }

      if (action === 'resume') {
        await resumeRobot(robotId)
        return
      }

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

  return (
    <AppShell
      subtitle={`${robotDetail.robot.robotCode} · Last updated ${formatRelativeTime(robotDetail.robot.updatedAt)}`}
      title={robotDetail.robot.label}
    >
      <div className="grid gap-6 xl:grid-cols-[1fr_1.7fr]">
        <section className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-950">Robot information</div>
              <div className="mt-1 text-xs text-slate-500">Live state from the adapter snapshot.</div>
            </div>
            <StatusBadge value={robotDetail.robot.status} />
          </div>

          <div className="mt-5 space-y-3 text-sm">
            <Row label="Robot code" value={robotDetail.robot.robotCode} />
            <Row label="Battery" value={`${robotDetail.state.batteryLevel}%`} />
            <Row label="Floor" value={robotDetail.robot.floorCode} />
            <Row label="Map" value={robotDetail.robot.mapName} />
            <Row label="Environment" value={robotDetail.state.environment} />
            <Row label="Localization" value={robotDetail.state.localizationState} />
            <Row
              label="Pose"
              value={`${robotDetail.pose.x.toFixed(1)}, ${robotDetail.pose.y.toFixed(1)} / ${robotDetail.pose.yawDeg.toFixed(0)}°`}
            />
          </div>

          {robotDetail.state.warning ? (
            <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{robotDetail.state.warning}</span>
              </div>
            </div>
          ) : null}

          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Commands
            </div>
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <select
                  className="h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white"
                  onChange={(event) => setDispatchLocationId(Number(event.target.value))}
                  value={selectedDispatchLocationId ?? undefined}
                >
                  {dispatchLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <button
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-700"
                  onClick={() => commandMutation.mutate('dispatch')}
                  type="button"
                >
                  <Route className="h-4 w-4" />
                  Dispatch
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600"
                  onClick={() => commandMutation.mutate('pause')}
                  type="button"
                >
                  <Pause className="h-4 w-4" />
                  Pause
                </button>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  onClick={() => commandMutation.mutate('resume')}
                  type="button"
                >
                  <Play className="h-4 w-4" />
                  Resume
                </button>
              </div>

              <button
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700"
                onClick={() => commandMutation.mutate('emergency-stop')}
                type="button"
              >
                <ShieldAlert className="h-4 w-4" />
                Emergency stop
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          {currentMap && currentFloor ? <MapCanvas floor={currentFloor} map={currentMap} /> : null}

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <div className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-950">Current task</div>
                  <div className="mt-1 text-xs text-slate-500">Task state and delivery progress.</div>
                </div>
                {robotDetail.activeTask ? (
                  <Link className="text-sm font-medium text-sky-700" to="/tasks">
                    Open tasks
                  </Link>
                ) : null}
              </div>

              {robotDetail.activeTask ? (
                <>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <Row label="Task code" value={robotDetail.activeTask.taskCode} />
                    <Row label="Status" value={robotDetail.activeTask.status} />
                    <Row label="Priority" value={robotDetail.activeTask.priority} />
                    <Row label="Type" value={robotDetail.activeTask.type} />
                    <Row label="Pickup" value={robotDetail.activeTask.pickupLocationName} />
                    <Row label="Dropoff" value={robotDetail.activeTask.dropoffLocationName} />
                  </div>

                  <div className="mt-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Progress
                    </div>
                    <div className="mt-4 space-y-4">
                      {robotDetail.activeTask.timeline.map((step) => (
                        <div className="flex items-start gap-3" key={step.key}>
                          <div className="mt-0.5 flex flex-col items-center">
                            <div
                              className={`h-3 w-3 rounded-full ${
                                step.state === 'done'
                                  ? 'bg-emerald-500'
                                  : step.state === 'current'
                                    ? 'bg-sky-500'
                                    : 'bg-slate-200'
                              }`}
                            />
                            <div className="h-7 w-px bg-slate-200" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-slate-900">{step.label}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {step.timestamp ? formatDateTime(step.timestamp) : 'Pending'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  No active task is assigned to this robot.
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div className="text-sm font-semibold text-slate-950">Live state</div>
              <div className="mt-1 text-xs text-slate-500">Telemetry and adapter heartbeat.</div>

              <div className="mt-4 space-y-4">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Connection</span>
                    <span className={robotDetail.state.online ? 'text-emerald-600' : 'text-slate-400'}>
                      {robotDetail.state.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <Radio className="h-4 w-4 text-sky-600" />
                    Updated {formatRelativeTime(robotDetail.state.updatedAt)}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Battery
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${robotDetail.state.batteryLevel}%` }}
                    />
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-700">
                    {robotDetail.state.batteryLevel}%
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Current pose is <strong>{robotDetail.pose.x.toFixed(1)}</strong>,{' '}
                  <strong>{robotDetail.pose.y.toFixed(1)}</strong> on <strong>{robotDetail.pose.floorCode}</strong>.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/88 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-4">
              {[
                ['commands', 'Command history'],
                ['events', 'Events'],
                ['tasks', 'Task history'],
                ['logs', 'Telemetry logs'],
              ].map(([key, label]) => (
                <button
                  className={`rounded-full px-4 py-2 text-sm font-medium ${
                    selectedTab === key
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                  key={key}
                  onClick={() => setSelectedTab(key as typeof selectedTab)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto px-2 pb-2 pt-1">
              {selectedTab === 'commands' ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Command</th>
                      <th className="px-4 py-3">Parameters</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Issued by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {robotDetail.commandHistory.map((command) => (
                      <tr key={command.id}>
                        <td className="px-4 py-3 text-slate-500">{formatDateTime(command.createdAt)}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{toTitle(command.commandType)}</td>
                        <td className="px-4 py-3 text-slate-500">{command.parameters || '--'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge value={command.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-500">{command.issuedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {selectedTab === 'events' ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {robotDetail.events.map((event) => (
                      <tr key={event.id}>
                        <td className="px-4 py-3 text-slate-500">{formatDateTime(event.createdAt)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge value={event.severity} />
                        </td>
                        <td className="px-4 py-3 text-slate-500">{event.type}</td>
                        <td className="px-4 py-3 text-slate-700">{event.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {selectedTab === 'tasks' ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Task</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Route</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {robotDetail.taskHistory.map((task) => (
                      <tr key={task.id}>
                        <td className="px-4 py-3 font-medium text-sky-700">{task.taskCode}</td>
                        <td className="px-4 py-3">
                          <StatusBadge value={task.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {task.pickupLocationName} <ArrowRight className="mx-1 inline h-3 w-3" /> {task.dropoffLocationName}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{formatDateTime(task.createdAt)}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDateTime(task.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {selectedTab === 'logs' ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Battery</th>
                      <th className="px-4 py-3">Pose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {robotDetail.logs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-4 py-3 text-slate-500">{formatDateTime(log.recordedAt)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge value={log.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">{log.batteryLevel}%</td>
                        <td className="px-4 py-3 text-slate-600">
                          {log.poseX.toFixed(1)}, {log.poseY.toFixed(1)} / {log.yawDeg.toFixed(0)}°
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  )
}
