import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Battery, BatteryWarning,
  Bot, ChevronDown, ChevronRight, Compass, Database,
  ExternalLink, HardDrive, MapPin, Pause, Play,
  RotateCcw, Save, Send, Square, Wifi, WifiOff,
} from 'lucide-react'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { StatusBadge } from '../components/StatusBadge'
import {
  dispatchRobot, emergencyStopRobot, getCurrentMap, getLivePose,
  getRobots, getSystemHealth, pauseRobot, relocalizeRobot, resumeRobot,
  saveSlamMap, setRobotFloor, startSlamExplore,
} from '../lib/api'
import { formatRelativeTime } from '../lib/utils'

export function RobotsPage() {
  const queryClient = useQueryClient()
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null)
  const [dispatchLocId, setDispatchLocId] = useState<number | null>(null)
  const [debugOpen, setDebugOpen] = useState(true)
  const [actionLog, setActionLog] = useState<string[]>([])
  const log = (m: string) =>
    setActionLog((p) => [`${new Date().toLocaleTimeString()} ${m}`, ...p].slice(0, 10))

  // ─ data ───────────────────────────────────────────────────────────────
  const robotsQuery = useQuery({
    queryKey: ['robots'],
    queryFn: getRobots,
    refetchInterval: 3000,
  })
  const robot = robotsQuery.data?.[0]
  const robotId = robot?.id

  const mapQuery = useQuery({
    queryKey: ['map', 'current'],
    queryFn: getCurrentMap,
    refetchInterval: 8000,
  })

  const healthQuery = useQuery({
    queryKey: ['system-health', robotId],
    queryFn: () => (robotId ? getSystemHealth(robotId) : Promise.resolve({})),
    enabled: !!robotId,
    refetchInterval: 5000,
  })

  const poseQuery = useQuery({
    queryKey: ['live-pose', robotId],
    queryFn: () => (robotId ? getLivePose(robotId) : Promise.resolve({ available: false })),
    enabled: !!robotId && debugOpen,
    refetchInterval: 2000,
  })

  // ─ mutations ──────────────────────────────────────────────────────────
  const refresh = () =>
    queryClient.invalidateQueries({ predicate: () => true })

  const goFloor = useMutation({
    mutationFn: async (floorId: number) => {
      if (!robotId) return null
      const r = await setRobotFloor(robotId, floorId)
      if (r.ok) {
        await startSlamExplore(robotId).catch(() => null)
      }
      return r
    },
    onSuccess: (r) => {
      if (!r) return
      if (!r.ok) log(`✗ Floor: ${r.reason ?? 'failed'}`)
      else if (r.mode === 'localization')
        log(`✓ Loaded ${r.floorCode} (${Math.round((r.blobBytes ?? 0) / 1e6)}MB)`)
      else log(`✓ New mapping for ${r.floorCode} — explore started`)
      refresh()
    },
  })

  const saveMap = useMutation({
    mutationFn: async () => {
      if (!robotId || !mapQuery.data) return null
      return saveSlamMap(robotId, { mapId: mapQuery.data.id, mapName: mapQuery.data.code })
    },
    onSuccess: () => {
      log(`✓ Save Map → ${mapQuery.data?.code}`)
      refresh()
    },
  })

  const reloc = useMutation({
    mutationFn: async () => (robotId ? relocalizeRobot(robotId) : null),
    onSuccess: (r) => {
      if (!r) return
      log(r.converged ? '✓ Relocalized' : `✗ Reloc: ${r.error ?? 'no convergence'}`)
    },
  })

  const cmd = useMutation({
    mutationFn: async (action: 'dispatch' | 'pause' | 'resume' | 'estop') => {
      if (!robotId) return
      if (action === 'dispatch') {
        if (!dispatchLocId) return
        await dispatchRobot(robotId, { locationId: dispatchLocId })
      } else if (action === 'pause') await pauseRobot(robotId)
      else if (action === 'resume') await resumeRobot(robotId)
      else await emergencyStopRobot(robotId)
    },
    onSuccess: (_d, action) => {
      log(`✓ ${action}`)
      refresh()
    },
  })

  if (robotsQuery.isLoading) {
    return (
      <AppShell title="Robot Console" subtitle="Loading...">
        <LoadingView label="Loading robot..." />
      </AppShell>
    )
  }
  if (!robot) {
    return (
      <AppShell title="Robot Console" subtitle="No robot">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <Bot className="mx-auto h-12 w-12 text-amber-600" />
          <p className="mt-4 text-amber-900">시드 데이터에 로봇이 없습니다. 백엔드 재기동 필요.</p>
        </div>
      </AppShell>
    )
  }

  const currentFloor = mapQuery.data?.floors.find((f) => f.code === robot.floorCode)
  const dispatchLocs = currentFloor?.locations.filter((l) => l.type !== 'CORRIDOR') ?? []
  const selectedDispatch = dispatchLocId ?? dispatchLocs[0]?.id ?? null
  const health = healthQuery.data ?? {}
  const pose = poseQuery.data
  const battery = robot.batteryLevel ?? 0
  const lowBattery = battery < 20

  return (
    <AppShell title={`${robot.label} Console`} subtitle="Single-robot operations & debugging">
      {/* ── 헤더 ───────────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <Bot className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">{robot.label}</h1>
                <span className="text-xs text-slate-400">#{robot.robotCode}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                <StatusBadge value={robot.status} />
                {robot.online ? (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <Wifi className="h-3 w-3" /> online
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-slate-400">
                    <WifiOff className="h-3 w-3" /> offline
                  </span>
                )}
                {robot.updatedAt && <span>updated {formatRelativeTime(robot.updatedAt)}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lowBattery ? (
              <BatteryWarning className="h-5 w-5 text-red-500" />
            ) : (
              <Battery className="h-5 w-5 text-emerald-500" />
            )}
            <div>
              <div className={`text-2xl font-bold ${lowBattery ? 'text-red-600' : 'text-slate-900'}`}>
                {battery}%
              </div>
              <div className="text-xs text-slate-500">battery</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 메인 그리드 ─────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-12 gap-6">
        <div className="col-span-12 space-y-4 lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900">현재 위치</span>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Floor" value={robot.floorCode || '—'} />
              <Row label="Map" value={robot.mapName || '—'} />
              <Row
                label="Live pose"
                value={
                  pose?.available && pose.x !== undefined && pose.y !== undefined
                    ? `(${pose.x?.toFixed(2)}, ${pose.y?.toFixed(2)})`
                    : '—'
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900">현재 태스크</span>
            </div>
            {robot.currentTaskCode ? (
              <>
                <div className="text-sm font-medium text-blue-600">{robot.currentTaskCode}</div>
                <div className="mt-1 text-xs text-slate-500">id #{robot.currentTaskId}</div>
              </>
            ) : (
              <div className="text-sm text-slate-400">없음</div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-slate-900">최근 액션</div>
            {actionLog.length === 0 ? (
              <div className="text-xs text-slate-400">아직 없음</div>
            ) : (
              <ul className="space-y-1 text-xs font-mono text-slate-600">
                {actionLog.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="col-span-12 space-y-4 lg:col-span-8">
          <Section title="Multi-session SLAM" icon={<Database className="h-4 w-4 text-indigo-600" />}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-1">
                <Label>Floor</Label>
                <select
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  onChange={(e) => setSelectedFloorId(Number(e.target.value))}
                  value={selectedFloorId ?? mapQuery.data?.floors[0]?.id ?? ''}
                >
                  {mapQuery.data?.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <ActionButton
                onClick={() => {
                  const fid = selectedFloorId ?? mapQuery.data?.floors[0]?.id
                  if (fid) goFloor.mutate(fid)
                }}
                disabled={goFloor.isPending}
                color="indigo"
                icon={<Compass className="h-4 w-4" />}
                label="Go to Floor"
              />
              <ActionButton
                onClick={() => saveMap.mutate()}
                disabled={saveMap.isPending || !mapQuery.data}
                color="slate"
                icon={<Save className="h-4 w-4" />}
                label="Save Map"
              />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <ActionButton
                onClick={() => reloc.mutate()}
                disabled={reloc.isPending}
                color="purple"
                icon={<RotateCcw className="h-4 w-4" />}
                label={reloc.isPending ? 'Spinning...' : 'Where am I?'}
                fullWidth
              />
              <a
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 md:col-span-2"
                href="https://app.foxglove.dev/?ds=foxglove-websocket&ds.url=ws://localhost:8765"
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="h-4 w-4" /> Open Foxglove (ws://localhost:8765)
              </a>
            </div>
          </Section>

          <Section title="Dispatch & Run" icon={<Send className="h-4 w-4 text-blue-600" />}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-1">
                <Label>Destination</Label>
                <select
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  disabled={!dispatchLocs.length}
                  onChange={(e) => setDispatchLocId(Number(e.target.value))}
                  value={selectedDispatch ?? ''}
                >
                  {dispatchLocs.length === 0 && <option>(no locations)</option>}
                  {dispatchLocs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <ActionButton
                onClick={() => cmd.mutate('dispatch')}
                disabled={cmd.isPending || !selectedDispatch}
                color="blue"
                icon={<Send className="h-4 w-4" />}
                label="Dispatch"
              />
              <div className="grid grid-cols-2 gap-2">
                <ActionButton
                  onClick={() => cmd.mutate('pause')}
                  disabled={cmd.isPending}
                  color="amber"
                  icon={<Pause className="h-4 w-4" />}
                  label="Pause"
                />
                <ActionButton
                  onClick={() => cmd.mutate('resume')}
                  disabled={cmd.isPending}
                  color="emerald"
                  icon={<Play className="h-4 w-4" />}
                  label="Resume"
                />
              </div>
            </div>
            <div className="mt-3">
              <ActionButton
                onClick={() => {
                  if (confirm('정말 비상정지 하시겠습니까?')) cmd.mutate('estop')
                }}
                disabled={cmd.isPending}
                color="red"
                icon={<Square className="h-4 w-4" />}
                label="EMERGENCY STOP"
                fullWidth
              />
            </div>
          </Section>
        </div>
      </div>

      {/* ── 디버그 패널 ────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <button
          className="flex w-full items-center justify-between px-5 py-3 text-left"
          onClick={() => setDebugOpen((v) => !v)}
          type="button"
        >
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-900">시스템 / 디버깅</span>
          </div>
          {debugOpen ? (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500" />
          )}
        </button>
        {debugOpen && (
          <div className="border-t border-slate-100 p-5">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  서비스 상태
                </h4>
                <div className="space-y-2 text-sm">
                  <HealthRow
                    label="Adapter (:8000)"
                    ok={health.adapter === 'ok'}
                    detail={health.adapter ?? 'unreachable'}
                  />
                  <HealthRow
                    label="Sim (gzserver)"
                    ok={!!health.sim_alive}
                    detail={health.sim_alive ? 'running' : 'down'}
                  />
                  <Row label="Disk free" value={health.disk_free_gb ? `${health.disk_free_gb} GB` : '—'} />
                  <Row
                    label="rtabmap.db"
                    value={health.rtabmap_db_size_mb ? `${health.rtabmap_db_size_mb} MB` : 'not yet'}
                  />
                  <Row label="ROS topics" value={health.ros_topic_count?.toString() ?? '—'} />
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  ROS 토픽
                </h4>
                <div className="grid grid-cols-2 gap-1 text-xs font-mono">
                  {Object.entries(health.ros_expected_topics ?? {}).map(([t, alive]) => (
                    <div key={t} className="flex items-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-full ${alive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={alive ? 'text-slate-700' : 'text-slate-400'}>{t}</span>
                    </div>
                  ))}
                  {!health.ros_expected_topics && <span className="text-slate-400">(어댑터 응답 없음)</span>}
                </div>
              </div>
            </div>

            {pose?.raw && (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Last /odom message (raw)
                </h4>
                <pre className="max-h-32 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  {pose.raw}
                </pre>
              </div>
            )}

            <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
              <AlertTriangle className="h-3 w-3" />
              상태 폴링 5s · pose 2s · robots 3s
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  )
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-emerald-700' : 'text-red-600'}`}>
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
        {detail}
      </span>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold text-slate-900">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-medium text-slate-500">{children}</div>
}

const colors = {
  blue: 'bg-blue-600 hover:bg-blue-700 text-white',
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  slate: 'bg-slate-700 hover:bg-slate-800 text-white',
  purple: 'bg-purple-600 hover:bg-purple-700 text-white',
  amber: 'bg-amber-500 hover:bg-amber-600 text-white',
  emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  red: 'bg-red-600 hover:bg-red-700 text-white ring-2 ring-red-600/30',
}

function ActionButton({
  onClick,
  disabled,
  color,
  icon,
  label,
  fullWidth,
}: {
  onClick: () => void
  disabled?: boolean
  color: keyof typeof colors
  icon: React.ReactNode
  label: string
  fullWidth?: boolean
}) {
  return (
    <button
      className={`flex h-10 ${fullWidth ? 'w-full' : ''} items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[color]}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}
