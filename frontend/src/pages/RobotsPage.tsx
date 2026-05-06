import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Battery, BatteryWarning,
  Bot, ChevronDown, ChevronRight, Compass, Database,
  ExternalLink, HardDrive, MapPin, Pause, Pencil, Play,
  RotateCcw, Save, Send, Square, Trash2, Wifi, WifiOff,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { StatusBadge } from '../components/StatusBadge'
import {
  discardMap, dispatchRobot, emergencyStopRobot, getLivePose, getMapMeta,
  getRobots, getSystemHealth, listMaps, loadSavedMap, MAP_PNG_URL,
  pauseRobot, relocalizeRobot, renameMap, resumeRobot, startSlamExplore,
} from '../lib/api'
import { formatRelativeTime } from '../lib/utils'

export function RobotsPage() {
  const queryClient = useQueryClient()
  const [newMapName, setNewMapName] = useState('')
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [actionLog, setActionLog] = useState<string[]>([])
  const log = (m: string) =>
    setActionLog((p) => [`${new Date().toLocaleTimeString()} ${m}`, ...p].slice(0, 10))

  const robotsQuery = useQuery({ queryKey: ['robots'], queryFn: getRobots, refetchInterval: 5000 })
  const robot = robotsQuery.data?.[0]
  const robotId = robot?.id
  const isDraft = robot?.mapName === 'Untitled' || !robot?.mapName

  const mapsQuery = useQuery({ queryKey: ['maps'], queryFn: listMaps, refetchInterval: 30000 })
  const healthQuery = useQuery({
    queryKey: ['system-health', robotId],
    queryFn: () => (robotId ? getSystemHealth(robotId) : Promise.resolve({})),
    enabled: !!robotId,
    refetchInterval: 10000,
  })
  const poseQuery = useQuery({
    queryKey: ['live-pose', robotId],
    queryFn: () => (robotId ? getLivePose(robotId) : Promise.resolve({ available: false })),
    enabled: !!robotId,
    refetchInterval: 1000,
  })
  const mapMetaQuery = useQuery({
    queryKey: ['map-meta'],
    queryFn: getMapMeta,
    refetchInterval: 3000,
  })

  const refresh = () => queryClient.invalidateQueries({ predicate: () => true })

  // 현재 맵 (draft) 의 이름을 사용자가 입력한 값으로 변경 = 영구 저장.
  const renameMut = useMutation({
    mutationFn: async () => {
      const name = newMapName.trim()
      if (!name || !robot?.mapId) return null
      return renameMap(robot.mapId, name)
    },
    onSuccess: (r) => {
      if (!r) return
      log(`✓ Renamed to "${r.name}"`)
      setNewMapName('')
      refresh()
    },
  })

  // 현재 맵 폐기 — 다음 fetch 시 새 Untitled 자동 생성.
  const discardMut = useMutation({
    mutationFn: async () => {
      if (!robot?.mapId) return null
      return discardMap(robot.mapId)
    },
    onSuccess: () => { log('✓ Discarded current map'); refresh() },
  })

  const loadMut = useMutation({
    mutationFn: async () => {
      if (!robotId || !selectedMapId) return null
      return loadSavedMap(robotId, selectedMapId)
    },
    onSuccess: async (r) => {
      if (!r) return
      if (!r.ok) log(`✗ Load: ${r.reason ?? 'failed'}`)
      else log(`✓ Loaded "${r.mapName}" (${Math.round((r.blobBytes ?? 0) / 1e6)}MB)`)
      refresh()
    },
  })

  const exploreMut = useMutation({
    mutationFn: async () => (robotId ? startSlamExplore(robotId) : null),
    onSuccess: () => log('✓ Exploration started'),
  })

  const relocMut = useMutation({
    mutationFn: async () => (robotId ? relocalizeRobot(robotId) : null),
    onSuccess: (r) => {
      if (!r) return
      log(r.converged ? '✓ Relocalized' : `✗ Reloc: ${r.error ?? 'no convergence'}`)
    },
  })

  const cmd = useMutation({
    mutationFn: async (action: 'dispatch' | 'pause' | 'resume' | 'estop') => {
      if (!robotId) return
      if (action === 'pause') await pauseRobot(robotId)
      else if (action === 'resume') await resumeRobot(robotId)
      else if (action === 'estop') await emergencyStopRobot(robotId)
    },
    onSuccess: (_d, a) => { log(`✓ ${a}`); refresh() },
  })

  if (robotsQuery.isLoading) {
    return <AppShell title="Robot Console" subtitle="Loading"><LoadingView label="" /></AppShell>
  }
  if (!robot) {
    return (
      <AppShell title="Robot Console" subtitle="No robot">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <Bot className="mx-auto h-12 w-12 text-amber-600" />
          <p className="mt-4 text-amber-900">시드 데이터에 로봇이 없습니다.</p>
        </div>
      </AppShell>
    )
  }

  const battery = robot.batteryLevel ?? 0
  const lowBattery = battery < 20
  const health = healthQuery.data ?? {}
  const pose = poseQuery.data
  const mapMeta = mapMetaQuery.data

  return (
    <AppShell title={`${robot.label} Console`} subtitle="Single-robot operations & debugging">
      {/* 헤더 */}
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
              <div className={`text-2xl font-bold ${lowBattery ? 'text-red-600' : 'text-slate-900'}`}>{battery}%</div>
              <div className="text-xs text-slate-500">battery</div>
            </div>
          </div>
        </div>
      </div>

      {/* 현재 맵 배너 — draft 면 노란색, 명명됐으면 emerald */}
      <div className={`mb-6 flex items-center justify-between rounded-xl border p-4 ${
        isDraft
          ? 'border-2 border-dashed border-amber-300 bg-amber-50'
          : 'border-emerald-300 bg-emerald-50'
      }`}>
        <div className="flex items-center gap-3">
          <Database className={`h-6 w-6 ${isDraft ? 'text-amber-600' : 'text-emerald-600'}`} />
          <div>
            <div className={`font-semibold ${isDraft ? 'text-amber-900' : 'text-emerald-900'}`}>
              현재 맵: {robot?.mapName ?? '(loading...)'}
              {isDraft && <span className="ml-2 text-xs italic">— 저장 안 됨</span>}
            </div>
            <div className={`text-xs ${isDraft ? 'text-amber-700' : 'text-emerald-700'}`}>
              {isDraft
                ? '이름을 붙여 저장하거나, 기존 맵에 합치거나, 폐기하세요.'
                : `map_id=${robot?.mapId}, code=${robot?.mapName ? '확인' : '—'}`}
            </div>
          </div>
        </div>
      </div>

      {/* 메인: 좌(컨트롤) + 우(라이브 맵) */}
      <div className="mb-6 grid grid-cols-12 gap-6">
        {/* LEFT */}
        <div className="col-span-12 space-y-4 lg:col-span-5">
          {/* 위치 / 태스크 */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900">현재 세션</span>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Map" value={robot.mapName ?? <span className="italic text-amber-600">Unknown</span>} />
              <Row label="Floor" value={robot.floorCode ?? <span className="italic text-slate-400">—</span>} />
              <Row
                label="Live pose"
                value={
                  pose?.available && pose.x != null && pose.y != null
                    ? `(${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}) yaw=${pose.yaw_deg?.toFixed(0)}°`
                    : '—'
                }
              />
              <Row
                label="Pose age"
                value={pose?.available ? `${pose.age_seconds}s${pose.stale ? ' (stale)' : ''}` : '—'}
              />
            </div>
          </div>

          {/* SLAM 세션 컨트롤 */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-semibold text-slate-900">SLAM 세션</span>
            </div>

            {/* 현재 맵 이름 변경 (= 저장) + 폐기 */}
            <div className="space-y-2">
              <Label>{isDraft ? '이 맵에 이름 붙여 저장' : '맵 이름 변경'}</Label>
              <div className="flex gap-2">
                <input
                  className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  onChange={(e) => setNewMapName(e.target.value)}
                  placeholder={robot?.mapName ?? '예: 5층, lab, hospital_2f'}
                  value={newMapName}
                />
                <ActionButton
                  onClick={() => renameMut.mutate()}
                  disabled={renameMut.isPending || !newMapName.trim() || !robot?.mapId}
                  color="slate"
                  icon={<Pencil className="h-4 w-4" />}
                  label={isDraft ? 'Save' : 'Rename'}
                />
              </div>
              <button
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                disabled={discardMut.isPending || !robot?.mapId}
                onClick={() => {
                  if (confirm(`현재 맵 "${robot?.mapName}" 을 폐기합니다. 진짜?`)) {
                    discardMut.mutate()
                  }
                }}
                type="button"
              >
                <Trash2 className="h-3 w-3" /> 폐기 (다음 fetch 시 새 Untitled 자동 생성)
              </button>
            </div>

            {/* Load saved map */}
            <div className="mt-4 space-y-2">
              <Label>저장된 맵 로드 (이게 그 맵이야!)</Label>
              <div className="flex gap-2">
                <select
                  className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  onChange={(e) => setSelectedMapId(Number(e.target.value) || null)}
                  value={selectedMapId ?? ''}
                >
                  <option value="">— 맵 선택 —</option>
                  {mapsQuery.data?.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <ActionButton
                  onClick={() => loadMut.mutate()}
                  disabled={loadMut.isPending || !selectedMapId}
                  color="indigo"
                  icon={<Compass className="h-4 w-4" />}
                  label="Load"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <ActionButton
                onClick={() => exploreMut.mutate()}
                disabled={exploreMut.isPending}
                color="emerald"
                icon={<Send className="h-4 w-4" />}
                label="탐사 시작"
                fullWidth
              />
              <ActionButton
                onClick={() => relocMut.mutate()}
                disabled={relocMut.isPending}
                color="purple"
                icon={<RotateCcw className="h-4 w-4" />}
                label={relocMut.isPending ? 'Spinning...' : 'Where am I?'}
                fullWidth
              />
            </div>
          </div>

          {/* Run controls */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <Send className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900">로봇 제어</span>
            </div>
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
            <div className="mt-3">
              <ActionButton
                onClick={() => { if (confirm('정말 비상정지?')) cmd.mutate('estop') }}
                disabled={cmd.isPending}
                color="red"
                icon={<Square className="h-4 w-4" />}
                label="EMERGENCY STOP"
                fullWidth
              />
            </div>
          </div>

          {/* 액션 로그 */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-slate-900">최근 액션</div>
            {actionLog.length === 0 ? (
              <div className="text-xs text-slate-400">아직 없음</div>
            ) : (
              <ul className="space-y-1 text-xs font-mono text-slate-600">
                {actionLog.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT: Live map viewer */}
        <div className="col-span-12 lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold text-slate-900">라이브 맵 (Top-down)</span>
              </div>
              {mapMeta?.available ? (
                <span className="text-xs text-slate-500">
                  {mapMeta.width}×{mapMeta.height} · {mapMeta.resolution?.toFixed(2)} m/px · {mapMeta.age_seconds}s ago
                </span>
              ) : (
                <span className="text-xs text-amber-600">맵 토픽 없음 — 탐사 시작 시 채워짐</span>
              )}
            </div>
            <MapCanvas
              available={!!mapMeta?.available}
              meta={mapMeta}
              pose={pose}
            />
          </div>
        </div>
      </div>

      {/* 디버그 */}
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
          {debugOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
        </button>
        {debugOpen && (
          <div className="border-t border-slate-100 p-5">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">서비스 상태</h4>
                <div className="space-y-2 text-sm">
                  <HealthRow label="Adapter (:8000)" ok={health.adapter === 'ok'} detail={health.adapter ?? 'unreachable'} />
                  <HealthRow label="Sim (gzserver)" ok={!!health.sim_alive} detail={health.sim_alive ? 'running' : 'down'} />
                  <Row label="Disk free" value={health.disk_free_gb ? `${health.disk_free_gb} GB` : '—'} />
                  <Row label="rtabmap.db" value={health.rtabmap_db_size_mb ? `${health.rtabmap_db_size_mb} MB` : 'not yet'} />
                </div>
              </div>
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">ROS 토픽</h4>
                <div className="grid grid-cols-2 gap-1 text-xs font-mono">
                  {Object.entries(health.ros_expected_topics ?? {}).map(([t, alive]) => (
                    <div key={t} className="flex items-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-full ${alive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={alive ? 'text-slate-700' : 'text-slate-400'}>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <a
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              href="https://app.foxglove.dev/?ds=foxglove-websocket&ds.url=ws://localhost:8765"
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-3 w-3" /> Foxglove (8765) — VS Code PORTS 에서 8765 forward 시에만
            </a>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <AlertTriangle className="h-3 w-3" />
              폴링: robots 5s · system 10s · pose 1s · map 3s
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── 라이브 맵 캔버스 ───────────────────────────────────────────────────
function MapCanvas({
  available,
  meta,
  pose,
}: {
  available: boolean
  meta: ReturnType<typeof getMapMeta> extends Promise<infer T> ? T | undefined : never
  pose: { available: boolean; x?: number | null; y?: number | null; yaw_rad?: number | null } | undefined
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const lastDrag = useRef({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement | null>(null)

  // PNG 폴링 — 캐시 우회 위해 timestamp 쿼리.
  useEffect(() => {
    if (!available) return
    const tick = () => {
      const img = new Image()
      img.onload = () => {
        imgRef.current = img
        draw()
      }
      img.src = `${MAP_PNG_URL}?t=${Date.now()}`
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [available])

  // pose 갱신 시 다시 그리기
  useEffect(() => { draw() }, [pose, scale, offset])

  function draw() {
    const c = canvasRef.current
    if (!c || !meta?.available) return
    const ctx = c.getContext('2d')!
    const W = c.width, H = c.height
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#f1f5f9'
    ctx.fillRect(0, 0, W, H)

    const img = imgRef.current
    if (!img) return

    // 맵 이미지의 자연 크기 (m): width*resolution × height*resolution
    const mapWm = (meta.width ?? 0) * (meta.resolution ?? 0.05)
    const mapHm = (meta.height ?? 0) * (meta.resolution ?? 0.05)

    // 캔버스에 fit + scale 적용. 1m → ?px
    const baseScale = Math.min(W / Math.max(mapWm, 1), H / Math.max(mapHm, 1)) * 0.9
    const px = baseScale * scale  // pixels per meter

    // 맵의 world 원점은 (origin_x, origin_y). 캔버스 중심을 world 원점에 맞추고 offset 더함.
    const cx = W / 2 + offset.x
    const cy = H / 2 + offset.y

    // 맵 이미지 그리기 (origin_x, origin_y 기준 좌하단부터)
    const imgW = mapWm * px
    const imgH = mapHm * px
    const imgX = cx + (meta.origin_x ?? 0) * px
    const imgY = cy - ((meta.origin_y ?? 0) + mapHm) * px  // y축 위쪽이 +
    ctx.drawImage(img, imgX, imgY, imgW, imgH)

    // 그리드 (1m 마다)
    ctx.strokeStyle = 'rgba(100,116,139,0.15)'
    ctx.lineWidth = 1
    for (let x = (cx % px); x < W; x += px) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let y = (cy % px); y < H; y += px) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    // 원점 표시
    ctx.fillStyle = '#94a3b8'
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill()

    // 로봇 pose
    if (pose?.available && pose.x != null && pose.y != null) {
      const rx = cx + pose.x * px
      const ry = cy - pose.y * px  // y up
      const yaw = pose.yaw_rad ?? 0
      // 화살표 (방향)
      ctx.save()
      ctx.translate(rx, ry)
      ctx.rotate(-yaw)  // ROS yaw 가 +z 방향, canvas 는 시계방향 + 라 반전
      ctx.fillStyle = '#2563eb'
      ctx.beginPath()
      ctx.moveTo(12, 0)
      ctx.lineTo(-8, -7)
      ctx.lineTo(-5, 0)
      ctx.lineTo(-8, 7)
      ctx.closePath()
      ctx.fill()
      // 카메라 FOV cone (D456 ~87°)
      ctx.fillStyle = 'rgba(37,99,235,0.15)'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      const fov = (87 * Math.PI) / 180
      const range = 50  // pixels
      ctx.arc(0, 0, range, -fov / 2, fov / 2)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  return (
    <div
      className="relative h-[60vh] overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
      onMouseDown={(e) => { setDragging(true); lastDrag.current = { x: e.clientX, y: e.clientY } }}
      onMouseLeave={() => setDragging(false)}
      onMouseMove={(e) => {
        if (!dragging) return
        const dx = e.clientX - lastDrag.current.x
        const dy = e.clientY - lastDrag.current.y
        lastDrag.current = { x: e.clientX, y: e.clientY }
        setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
      }}
      onMouseUp={() => setDragging(false)}
      onWheel={(e) => {
        e.preventDefault()
        setScale((s) => Math.max(0.1, Math.min(20, s * (e.deltaY < 0 ? 1.1 : 0.9))))
      }}
    >
      <canvas ref={canvasRef} width={1200} height={700} className="h-full w-full cursor-grab" />
      {!available && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          /map 토픽 미수신 — 탐사 시작 후 RTAB-Map 이 grid_map 발행하면 표시됩니다
        </div>
      )}
      <div className="absolute bottom-2 right-2 rounded bg-white/80 px-2 py-1 text-[10px] text-slate-600 backdrop-blur">
        scale {scale.toFixed(1)}× · 휠=줌, 드래그=이동
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
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
  onClick, disabled, color, icon, label, fullWidth,
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
      className={`flex h-10 ${fullWidth ? 'w-full' : ''} items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[color]}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}
