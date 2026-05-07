import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight,
  Crosshair, Power, RotateCcw, Send, Square,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import {
  emergencyStopRobot, getLivePose, getMapMeta,
  getRobots, getSystemHealth, listMaps, loadSavedMap,
  pauseRobot, relocalizeRobot, renameMap, resumeRobot, startSlamExplore,
  stopSlam, teleop,
} from '../lib/api'

type TabId = 'mapinfo' | 'action' | 'log' | 'health' | 'debug'
const TABS: { id: TabId; label: string }[] = [
  { id: 'mapinfo', label: '맵' },
  { id: 'action',  label: '조작' },
  { id: 'log',     label: '로그' },
  { id: 'health',  label: '헬스' },
  { id: 'debug',   label: '디버그' },
]

type ActionMode = 'idle' | 'goto-arming' | 'goto-placed' | 'reloc' | 'slam'

// 사이드/도크 크기는 localStorage 에 저장 → 새로고침 후 유지
const LS_SIDE = 'console.sideWidth'
const LS_DOCK = 'console.dockHeight'

export function RobotsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('mapinfo')
  const [dockOpen, setDockOpen] = useState(true)
  const [actionLog, setActionLog] = useState<string[]>([])
  const [actionMode, setActionMode] = useState<ActionMode>('idle')
  const [goalPreview, setGoalPreview] = useState<{ x: number; y: number } | null>(null)
  const log = useCallback((m: string) =>
    setActionLog((p) => [`${new Date().toLocaleTimeString()} ${m}`, ...p].slice(0, 50)), [])

  // 패널 크기 (px). 초기값 ls → 기본
  const [sideWidth, setSideWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_SIDE) ?? '', 10)
    return Number.isFinite(v) && v >= 240 && v <= 600 ? v : 320
  })
  const [dockHeight, setDockHeight] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_DOCK) ?? '', 10)
    return Number.isFinite(v) && v >= 80 && v <= 600 ? v : 200
  })
  useEffect(() => { localStorage.setItem(LS_SIDE, String(sideWidth)) }, [sideWidth])
  useEffect(() => { localStorage.setItem(LS_DOCK, String(dockHeight)) }, [dockHeight])

  const robotsQuery = useQuery({ queryKey: ['robots'], queryFn: getRobots, refetchInterval: 5000 })
  const robot = robotsQuery.data?.[0]
  const robotId = robot?.id
  const isDraft = robot?.mapName === 'Untitled' || !robot?.mapName

  const mapsQuery = useQuery({ queryKey: ['maps'], queryFn: listMaps, refetchInterval: 30000 })
  const healthQuery = useQuery({
    queryKey: ['system-health', robotId],
    queryFn: () => (robotId ? getSystemHealth(robotId) : Promise.resolve({})),
    enabled: !!robotId,
    refetchInterval: 5000,
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

  const renameMut = useMutation({
    mutationFn: async (name: string) =>
      (name.trim() && robot?.mapId) ? renameMap(robot.mapId, name.trim()) : null,
    onSuccess: (r) => { if (r) { log(`renamed → "${r.name}"`); refresh() } },
  })
  const loadMut = useMutation({
    mutationFn: async (mapId: number) => robotId ? loadSavedMap(robotId, mapId) : null,
    onSuccess: (r) => {
      if (!r) return
      log(r.ok ? `loaded "${r.mapName}"` : `load failed: ${r.reason ?? '?'}`)
      refresh()
    },
  })
  const exploreMut = useMutation({
    mutationFn: async () => robotId ? startSlamExplore(robotId) : null,
    onSuccess: () => { log('slam+explore started'); setActionMode('slam'); refresh() },
  })
  const slamStopMut = useMutation({
    mutationFn: async () => robotId ? stopSlam(robotId) : null,
    onSuccess: () => { log('slam stopped'); setActionMode('idle'); refresh() },
  })
  const relocMut = useMutation({
    mutationFn: async () => robotId ? relocalizeRobot(robotId) : null,
    onSuccess: (r) => {
      if (r) log(r.converged ? 'relocalized' : `reloc failed: ${r.error ?? '?'}`)
      setActionMode('idle')
    },
  })
  const cmd = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'estop') => {
      if (!robotId) return
      if (action === 'pause') await pauseRobot(robotId)
      else if (action === 'resume') await resumeRobot(robotId)
      else if (action === 'estop') await emergencyStopRobot(robotId)
    },
    onSuccess: (_d, a) => { log(a); refresh() },
  })

  // 텔레옵 publish 인터벌 + healthQuery 참조 (정지 시 SLAM 활성 여부 확인).
  const teleopIntervalRef = useRef<number | null>(null)
  const stopBurstRef = useRef<number | null>(null)
  // 최신 health 를 stopTeleop 에서 참조하기 위한 ref. 콜백이 stale 안 되게.
  const slamActiveRef = useRef(false)
  useEffect(() => { slamActiveRef.current = !!(healthQuery.data?.slam_active || healthQuery.data?.explore_active) },
            [healthQuery.data])

  // 정지: 안전하게 (0,0) 을 짧게 burst 로 보내 simulator/velocity_smoother 가 확실히 받게.
  // SLAM/explore 활성 시: explore 가 ~5-10Hz 로 cmd_vel publish 중이라 우리의 (0,0) 은
  // 곧 덮어쓰여 SLAM 이 자연 재개 → 사실상 "사용자가 손 떼면 SLAM 다시 진행".
  // SLAM 비활성 시: 아무도 cmd_vel 안 쓰니 (0,0) 이 마지막 값으로 남아 robot 정지.
  const stopTeleop = useCallback(() => {
    if (teleopIntervalRef.current != null) {
      clearInterval(teleopIntervalRef.current)
      teleopIntervalRef.current = null
    }
    if (stopBurstRef.current != null) clearInterval(stopBurstRef.current)
    let n = 0
    const burst = () => {
      teleop(0, 0).catch(() => {})
      n += 1
      // SLAM 안 도는 중이면 5번까지 (~500ms) 보내 packet drop 대비.
      // SLAM 도는 중이면 1번이면 충분 — explore 가 즉시 재개.
      const limit = slamActiveRef.current ? 1 : 5
      if (n >= limit) {
        if (stopBurstRef.current != null) clearInterval(stopBurstRef.current)
        stopBurstRef.current = null
      }
    }
    burst()
    if (!slamActiveRef.current) {
      stopBurstRef.current = window.setInterval(burst, 100) as unknown as number
    }
  }, [])
  const startTeleop = useCallback((linear: number, angular: number) => {
    // 새 명령 시작 → 진행 중인 정지 burst 취소
    if (stopBurstRef.current != null) { clearInterval(stopBurstRef.current); stopBurstRef.current = null }
    if (teleopIntervalRef.current != null) clearInterval(teleopIntervalRef.current)
    teleop(linear, angular).catch(() => {})
    teleopIntervalRef.current = window.setInterval(() => {
      teleop(linear, angular).catch(() => {})
    }, 100) as unknown as number
  }, [])

  // WASD: 조작 탭 활성 + 도크 열림 시 (액션 모드 무관 — 수동 백업).
  // e.code 사용 — 한글/영어 자판 무관 (물리적 키 위치 기반).
  // window blur (alt-tab 등) 시 모든 키 release 처리 → "키가 눌린 채 떠있어 robot 무한 이동"
  // 방지.
  useEffect(() => {
    if (activeTab !== 'action' || !dockOpen) return
    const isText = (el: EventTarget | null) =>
      el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
    const CODE_TO_KEY: Record<string, string> = {
      KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
    }
    const LIN = 0.4, ANG = 0.8
    const pressed = new Set<string>()
    const apply = () => {
      if (pressed.size === 0) { stopTeleop(); return }
      const lin = (pressed.has('w') ? LIN : 0) + (pressed.has('s') ? -LIN : 0)
      const ang = (pressed.has('a') ? ANG : 0) + (pressed.has('d') ? -ANG : 0)
      startTeleop(lin, ang)
    }
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (isText(e.target)) return
      const k = CODE_TO_KEY[e.code]
      if (!k) return
      e.preventDefault()
      if (down) pressed.add(k); else pressed.delete(k)
      apply()
    }
    const dn = (e: KeyboardEvent) => onKey(e, true)
    const up = (e: KeyboardEvent) => onKey(e, false)
    const onBlur = () => { pressed.clear(); stopTeleop() }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', onBlur)
      pressed.clear()
      stopTeleop()
    }
  }, [activeTab, dockOpen, startTeleop, stopTeleop])

  if (robotsQuery.isLoading) {
    return <AppShell title="Robot Console" subtitle=""><LoadingView label="" /></AppShell>
  }
  if (!robot) {
    return (
      <AppShell title="Robot Console" subtitle="">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-8 text-center text-amber-800">
          시드 데이터에 로봇이 없습니다.
        </div>
      </AppShell>
    )
  }

  const health = healthQuery.data ?? {}
  const pose = poseQuery.data
  const mapMeta = mapMetaQuery.data
  const currentMap = mapsQuery.data?.find((m) => m.id === robot.mapId)

  // 맵 클릭: '목적지 이동' arming 상태에서만 goal preview 설정 (자동 발행 X)
  const onMapClickWorld = (x: number, y: number) => {
    if (actionMode === 'goto-arming') {
      setGoalPreview({ x, y })
      setActionMode('goto-placed')
    } else if (actionMode === 'goto-placed') {
      // 다시 클릭 시 위치 갱신
      setGoalPreview({ x, y })
    }
  }

  const publishGoto = () => {
    if (!goalPreview) return
    fetch('/api/system/nav/goto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: goalPreview.x, y: goalPreview.y, yaw: 0 }),
    }).then(() => log(`goto (${goalPreview.x.toFixed(2)}, ${goalPreview.y.toFixed(2)}) 발행`))
      .catch(() => log('goto fail'))
    // 발행 후 idle 로 (마커는 그대로 둠 — 새 액션 시 사라짐)
    setActionMode('idle')
  }
  const cancelGoto = () => { setActionMode('idle'); setGoalPreview(null) }

  return (
    <AppShell title={robot.label} subtitle="">
      <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col bg-slate-100 text-slate-800">
        {/* Toolbar */}
        <div className="flex h-10 flex-shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 text-sm">
          <ToolBtn onClick={() => cmd.mutate('pause')} label="Pause" />
          <ToolBtn onClick={() => cmd.mutate('resume')} label="Resume" />
          <Sep />
          <button
            type="button"
            onClick={() => { if (confirm('비상정지?')) cmd.mutate('estop') }}
            className="flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 font-bold text-white hover:bg-red-500"
          >
            <Square className="h-3.5 w-3.5" /> ESTOP
          </button>
          <div className="ml-auto flex items-center gap-3 text-slate-500">
            <span>#{robot.robotCode}</span>
            <span className={robot.online ? 'text-emerald-600' : 'text-slate-400'}>
              {robot.online ? '● online' : '○ offline'}
            </span>
            <span>{robot.status}</span>
            <span className={(robot.batteryLevel ?? 0) < 20 ? 'text-red-600' : ''}>
              bat {robot.batteryLevel ?? 0}%
            </span>
          </div>
        </div>

        {/* Main row: 좌(map+dock 세로 stack) + 사이드(풀 높이) */}
        <div className="flex min-h-0 flex-1">
          {/* 좌측: map (flex-1) + horizontal splitter + dock (고정 height) */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1 bg-slate-200">
              <MapCanvas
                pose={pose}
                armed={actionMode === 'goto-arming' || actionMode === 'goto-placed'}
                goalPreview={goalPreview}
                onMapClickWorld={onMapClickWorld}
              />
            </div>
            {dockOpen && (
              <Splitter axis="y" onResize={(d) => setDockHeight((h) => clamp(h - d, 80, 600))} />
            )}
            <BottomDock
              open={dockOpen}
              height={dockHeight}
              activeTab={activeTab}
              setOpen={setDockOpen}
              setActiveTab={setActiveTab}
            >
              {activeTab === 'mapinfo' && (
                <MapPanel
                  mapMeta={mapMeta} currentMap={currentMap} isDraft={isDraft}
                  allMaps={mapsQuery.data ?? []}
                  slamActive={!!health.slam_active}
                  onLoad={(id: number) => { if (health.slam_active) slamStopMut.mutate(); loadMut.mutate(id) }}
                  onRename={(n: string) => renameMut.mutate(n)}
                />
              )}
              {activeTab === 'action' && (
                <ActionPanel
                  mode={actionMode}
                  goalPreview={goalPreview}
                  exploreActive={!!health.explore_active}
                  relocPending={relocMut.isPending}
                  onArmGoto={() => { setActionMode('goto-arming'); setGoalPreview(null) }}
                  onPublishGoto={publishGoto}
                  onCancelGoto={cancelGoto}
                  onReloc={() => { setActionMode('reloc'); relocMut.mutate() }}
                  onSlamStart={() => exploreMut.mutate()}
                  onSlamStop={() => slamStopMut.mutate()}
                  startTeleop={startTeleop}
                  stopTeleop={stopTeleop}
                />
              )}
              {activeTab === 'log' && <LogPanel log={actionLog} />}
              {activeTab === 'health' && <HealthPanel health={health} />}
              {activeTab === 'debug' && <DebugPanel health={health} />}
            </BottomDock>
          </div>

          {/* Vertical splitter — 좌측 컬럼과 사이드 사이 */}
          <Splitter axis="x" onResize={(d) => setSideWidth((w) => clamp(w - d, 240, 600))} />

          {/* Side inspector — 풀 높이 (header 아래 ~ status 위 전체) */}
          <aside
            className="flex flex-shrink-0 flex-col overflow-hidden bg-white"
            style={{ width: sideWidth }}
          >
            {/* 카메라 — 항상 우상단 고정, accordion 아님 */}
            <div className="flex-shrink-0 border-b border-slate-200">
              <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span>카메라</span>
              </div>
              <CameraView />
            </div>
            {/* 아래: 스크롤 accordion */}
            <div className="flex-1 overflow-y-auto">
              <Section title="STATUS" defaultOpen>
                <KV k="status" v={robot.status} />
                <KV k="online" v={robot.online ? 'yes' : 'no'}
                    vClass={robot.online ? 'text-emerald-600' : 'text-slate-400'} />
                <KV k="battery" v={`${robot.batteryLevel ?? 0}%`}
                    vClass={(robot.batteryLevel ?? 0) < 20 ? 'text-red-600' : ''} />
                <KV k="floor" v={robot.floorCode ?? '—'} />
              </Section>
              <Section title="POSE" defaultOpen>
                <KV k="x" v={fmt(pose?.x)} />
                <KV k="y" v={fmt(pose?.y)} />
                <KV k="yaw" v={pose?.yaw_deg != null ? `${pose.yaw_deg.toFixed(0)}°` : '—'} />
                <KV k="age" v={pose?.available ? `${pose.age_seconds}s` : '—'}
                    vClass={pose?.stale ? 'text-amber-600' : ''} />
              </Section>
              <Section title="MAP" defaultOpen>
                <KV k="name" v={robot.mapName ?? '—'} />
                <KV k="state" v={isDraft ? 'draft' : 'saved'}
                    vClass={isDraft ? 'text-amber-600' : 'text-emerald-600'} />
                <KV k="size" v={mapMeta?.available ? `${mapMeta.width}×${mapMeta.height}` : '—'} />
                <KV k="m/px" v={mapMeta?.resolution?.toFixed(2) ?? '—'} />
                <KV k="age" v={mapMeta?.available ? `${mapMeta.age_seconds}s` : '—'} />
              </Section>
              <Section title="SLAM">
                <KV k="slam" v={health.slam_active ? 'active' : 'idle'}
                    vClass={health.slam_active ? 'text-indigo-600' : 'text-slate-400'} />
                <KV k="explore" v={health.explore_active ? 'running' : 'idle'}
                    vClass={health.explore_active ? 'text-emerald-600' : 'text-slate-400'} />
                <KV k="sim" v={health.sim_alive ? 'up' : 'down'}
                    vClass={health.sim_alive ? 'text-emerald-600' : 'text-red-600'} />
              </Section>
            </div>
          </aside>
        </div>

        {/* Status bar */}
        <div className="flex h-7 flex-shrink-0 items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-500">
          <span>topics {Object.values(health.ros_expected_topics ?? {}).filter(Boolean).length}/{Object.keys(health.ros_expected_topics ?? {}).length}</span>
          <span>·</span>
          <span>map {mapMeta?.available ? `${mapMeta.width}×${mapMeta.height}` : '—'}</span>
          <span>·</span>
          <span className={pose?.stale ? 'text-amber-600' : ''}>
            pose {pose?.available ? `${pose.age_seconds}s` : '—'}
          </span>
          <span className="ml-auto">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </AppShell>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2))
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-200" />
}

function ToolBtn({
  onClick, disabled, label, icon, accent,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  icon?: React.ReactNode
  accent?: 'emerald'
}) {
  const base = accent === 'emerald'
    ? 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400'
    : 'text-slate-700 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded px-2 py-1 ${base}`}
    >
      {icon}{label}
    </button>
  )
}

// ── Bottom dock (탭 바 + 컨텐츠) ──────────────────────────────────────────
function BottomDock({
  open, height, activeTab, setOpen, setActiveTab, children,
}: {
  open: boolean
  height: number
  activeTab: TabId
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void
  setActiveTab: (id: TabId) => void
  children: React.ReactNode
}) {
  return (
    <div
      className="flex flex-shrink-0 flex-col border-t border-slate-200 bg-white"
      style={{ height: open ? height : 32 }}
    >
      <div className="flex h-9 flex-shrink-0 items-stretch border-b border-slate-200 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-10 items-center justify-center text-slate-400 hover:bg-slate-100"
          title={open ? '도크 접기' : '도크 펼치기'}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setActiveTab(t.id); setOpen(true) }}
            className={`min-w-[6rem] border-r border-slate-200 px-6 font-medium transition ${
              activeTab === t.id && open
                ? 'bg-slate-100 font-semibold text-slate-900'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="flex-1 overflow-auto p-3 text-sm leading-6">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Resizable splitter ───────────────────────────────────────────────────
function Splitter({
  axis, onResize,
}: {
  axis: 'x' | 'y'
  onResize: (delta: number) => void
}) {
  const dragging = useRef(false)
  const lastPos = useRef(0)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const cur = axis === 'x' ? e.clientX : e.clientY
      const d = cur - lastPos.current
      lastPos.current = cur
      // x: 좌측 드래그 = 사이드바 넓힘 (delta 부호 호출자가 처리)
      onResize(axis === 'x' ? d : d)
    }
    const onUp = () => { dragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [axis, onResize])

  if (axis === 'x') {
    return (
      <div
        className="w-1 flex-shrink-0 cursor-col-resize bg-slate-200 hover:bg-blue-400"
        onMouseDown={(e) => { dragging.current = true; lastPos.current = e.clientX; document.body.style.cursor = 'col-resize' }}
      />
    )
  }
  return (
    <div
      className="h-1 flex-shrink-0 cursor-row-resize bg-slate-200 hover:bg-blue-400"
      onMouseDown={(e) => { dragging.current = true; lastPos.current = e.clientY; document.body.style.cursor = 'row-resize' }}
    />
  )
}

// ── Section accordion ─────────────────────────────────────────────────────
function Section({
  title, defaultOpen = false, children,
}: {
  title: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && <div className="px-3 pb-2 font-mono text-sm">{children}</div>}
    </div>
  )
}

function KV({ k, v, vClass }: { k: string; v: React.ReactNode; vClass?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 leading-6">
      <span className="text-slate-500">{k}</span>
      <span className={`text-slate-800 ${vClass ?? ''}`}>{v}</span>
    </div>
  )
}

// ── Camera (real data-flow) ───────────────────────────────────────────────
function CameraView() {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [lastFrame, setLastFrame] = useState(0)
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/camera`
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => { timer = setTimeout(connect, 2000) }
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          const blob = new Blob([ev.data], { type: 'image/jpeg' })
          setImgUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
          setLastFrame(Date.now())
        }
      }
    }
    connect()
    return () => { if (timer) clearTimeout(timer); ws?.close() }
  }, [])
  const ageMs = Date.now() - lastFrame
  const live = lastFrame > 0 && ageMs < 2000
  return (
    <div>
      <div className="aspect-video w-full bg-slate-900">
        {imgUrl
          ? <img src={imgUrl} alt="" className="h-full w-full object-contain" />
          : <div className="flex h-full items-center justify-center font-mono text-xs text-slate-500">no signal</div>}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-1 font-mono text-xs">
        <span className={live ? 'text-emerald-600' : 'text-slate-400'}>
          {live ? '● live' : '○ no signal'}
        </span>
        <span className="text-slate-400">
          {lastFrame > 0 ? `${(ageMs / 1000).toFixed(1)}s ago` : ''}
        </span>
      </div>
    </div>
  )
}

// ── Panels ────────────────────────────────────────────────────────────────
function MapPanel({
  mapMeta, currentMap, isDraft, allMaps, slamActive, onLoad, onRename,
}: any) {
  const [name, setName] = useState('')
  const others = useMemo(
    () => allMaps.filter((m: any) => m.id !== currentMap?.id && m.rtabmapDbPath),
    [allMaps, currentMap?.id])
  return (
    <PanelGrid cols={3}>
      <Subpanel title="현재 맵">
        {currentMap ? (
          <div className="font-mono">
            <KV k="이름" v={currentMap.name} />
            <KV k="상태" v={isDraft ? 'draft (미저장)' : 'saved'}
                vClass={isDraft ? 'text-amber-600' : 'text-emerald-600'} />
            {isDraft && (
              <>
                <div className="mt-2 flex gap-1">
                  <input
                    className="h-7 flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-800"
                    placeholder="이름 입력 = 저장"
                    value={name} onChange={(e) => setName(e.target.value)}
                  />
                  <button type="button"
                    className="rounded bg-blue-600 px-2.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                    disabled={!name.trim()} onClick={() => { onRename(name); setName('') }}>
                    save
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  저장 안 하면 다음 세션 시작 시 폐기됨
                </p>
              </>
            )}
          </div>
        ) : <p className="text-slate-400">맵 없음</p>}
      </Subpanel>

      <Subpanel title={`저장된 맵 (${others.length})`}>
        {others.length === 0 ? (
          <p className="text-slate-400">없음</p>
        ) : (
          <ul className="space-y-1">
            {others.map((m: any) => (
              <li key={m.id} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1">
                <div className="min-w-0 flex-1 truncate text-slate-700">{m.name}</div>
                <button type="button" onClick={() => onLoad(m.id)}
                  title={slamActive ? 'SLAM 자동 중지 후 로드' : '로드'}
                  className="rounded bg-indigo-600 px-2 py-0.5 text-xs text-white hover:bg-indigo-500">
                  연결
                </button>
              </li>
            ))}
          </ul>
        )}
        {slamActive && others.length > 0 && (
          <p className="mt-1 text-xs text-amber-600">⚠ 연결 시 활성 SLAM 자동 중지</p>
        )}
      </Subpanel>

      <Subpanel title="맵 메타데이터">
        <div className="font-mono">
          <KV k="크기" v={mapMeta?.available ? `${mapMeta.width}×${mapMeta.height}` : '—'} />
          <KV k="해상도" v={mapMeta?.resolution != null ? `${mapMeta.resolution.toFixed(2)} m/px` : '—'} />
          <KV k="origin" v={mapMeta?.available ? `(${mapMeta.origin_x?.toFixed(1)}, ${mapMeta.origin_y?.toFixed(1)})` : '—'} />
          <KV k="last update" v={mapMeta?.available ? `${mapMeta.age_seconds}s ago` : '—'}
              vClass={!mapMeta?.available || mapMeta.age_seconds > 30 ? 'text-slate-400' : ''} />
        </div>
      </Subpanel>
    </PanelGrid>
  )
}

// ── ActionPanel: 3 액션 (이동·내 위치·SLAM) + 보조 수동 조작 ───────────────
function ActionPanel({
  mode, goalPreview, exploreActive, relocPending,
  onArmGoto, onPublishGoto, onCancelGoto,
  onReloc, onSlamStart, onSlamStop,
  startTeleop, stopTeleop,
}: {
  mode: ActionMode
  goalPreview: { x: number; y: number } | null
  exploreActive: boolean
  relocPending: boolean
  onArmGoto: () => void
  onPublishGoto: () => void
  onCancelGoto: () => void
  onReloc: () => void
  onSlamStart: () => void
  onSlamStop: () => void
  startTeleop: (l: number, a: number) => void
  stopTeleop: () => void
}) {
  const slamRunning = mode === 'slam' || exploreActive
  const relocRunning = mode === 'reloc' || relocPending
  const gotoArmed = mode === 'goto-arming' || mode === 'goto-placed'
  return (
    <PanelGrid cols={2}>
      <Subpanel title="이벤트 발행">
        <div className="flex flex-col gap-2">
        <ActionRow
          icon={<Crosshair className="h-4 w-4" />}
          label="목적지 이동"
          accent="blue"
          active={gotoArmed}
          disabled={mode !== 'idle' && !gotoArmed}
          onClick={onArmGoto}
        >
          {mode === 'goto-arming' && (
            <span className="text-xs text-slate-500">맵 클릭으로 위치 지정</span>
          )}
          {mode === 'goto-placed' && goalPreview && (
            <>
              <span className="font-mono text-xs text-slate-700">
                ({goalPreview.x.toFixed(2)}, {goalPreview.y.toFixed(2)})
              </span>
              <button type="button" onClick={onPublishGoto}
                className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500">
                발행
              </button>
            </>
          )}
          {gotoArmed && (
            <button type="button" onClick={onCancelGoto}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
              취소
            </button>
          )}
        </ActionRow>

        <ActionRow
          icon={<RotateCcw className="h-4 w-4" />}
          label="내 위치 찾기"
          accent="purple"
          active={relocRunning}
          disabled={mode !== 'idle' && !relocRunning}
          onClick={onReloc}
        >
          {relocRunning && <span className="text-xs text-purple-700">⟳ 회전 중…</span>}
        </ActionRow>

        <ActionRow
          icon={<Send className="h-4 w-4" />}
          label="SLAM 자율탐사"
          accent="emerald"
          active={slamRunning}
          disabled={mode !== 'idle' && !slamRunning}
          onClick={onSlamStart}
        >
          {slamRunning && (
            <>
              <span className="text-xs text-emerald-700">● 진행 중</span>
              <button type="button" onClick={onSlamStop}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                중지
              </button>
            </>
          )}
        </ActionRow>
        </div>
      </Subpanel>

      <Subpanel title="수동 조작 (WASD)">
        <div className="flex flex-col items-start gap-2">
          <ManualTeleop startTeleop={startTeleop} stopTeleop={stopTeleop} />
          <p className="text-xs leading-snug text-slate-500">
            키보드 W/A/S/D 또는 마우스 hold = 이동 · release = 정지
          </p>
        </div>
      </Subpanel>
    </PanelGrid>
  )
}

// 단일 행 액션 — 아이콘 + 라벨 버튼 (색상별), active 면 옆에 컨텐츠 inline.
function ActionRow({
  icon, label, accent, active, disabled, onClick, children,
}: {
  icon: React.ReactNode
  label: string
  accent: 'blue' | 'purple' | 'emerald'
  active: boolean
  disabled?: boolean
  onClick: () => void
  children?: React.ReactNode
}) {
  const idle = {
    blue:    'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100',
    purple:  'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100',
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  }[accent]
  const on = {
    blue:    'bg-blue-600 text-white hover:bg-blue-500',
    purple:  'bg-purple-600 text-white hover:bg-purple-500',
    emerald: 'bg-emerald-600 text-white hover:bg-emerald-500',
  }[accent]
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex h-9 w-44 items-center gap-2 rounded border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          active ? `border-transparent ${on}` : idle
        }`}
      >
        {icon}
        {label}
      </button>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

function ManualTeleop({
  startTeleop, stopTeleop,
}: {
  startTeleop: (l: number, a: number) => void
  stopTeleop: () => void
}) {
  // 키보드 키캡 스타일 (WASD). 키보드 입력 또는 마우스 hold 시 하이라이트.
  // e.code 사용으로 한글 자판도 OK.
  const [held, setHeld] = useState<Set<string>>(new Set())
  useEffect(() => {
    const isText = (el: EventTarget | null) =>
      el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
    const CODE_TO_KEY: Record<string, string> = {
      KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
    }
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (isText(e.target)) return
      const k = CODE_TO_KEY[e.code]
      if (!k) return
      setHeld((prev) => {
        const next = new Set(prev)
        if (down) next.add(k); else next.delete(k)
        return next
      })
    }
    const dn = (e: KeyboardEvent) => onKey(e, true)
    const up = (e: KeyboardEvent) => onKey(e, false)
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <KeyCap k="w" label="W" l={0.4} a={0}
              held={held} setHeld={setHeld} startTeleop={startTeleop} stopTeleop={stopTeleop} />
      <div className="flex gap-1">
        <KeyCap k="a" label="A" l={0} a={0.8}
                held={held} setHeld={setHeld} startTeleop={startTeleop} stopTeleop={stopTeleop} />
        <KeyCap k="s" label="S" l={-0.4} a={0}
                held={held} setHeld={setHeld} startTeleop={startTeleop} stopTeleop={stopTeleop} />
        <KeyCap k="d" label="D" l={0} a={-0.8}
                held={held} setHeld={setHeld} startTeleop={startTeleop} stopTeleop={stopTeleop} />
      </div>
    </div>
  )
}

// KeyCap 을 ManualTeleop 밖에 정의 — 내부 정의 시 매 렌더마다 새 컴포넌트 만들어져
// React 가 unmount/remount 하면서 pointer capture 깨지고 active 시각 효과 안 보임.
function KeyCap({
  k, label, l, a, held, setHeld, startTeleop, stopTeleop,
}: {
  k: string
  label: string
  l: number
  a: number
  held: Set<string>
  setHeld: React.Dispatch<React.SetStateAction<Set<string>>>
  startTeleop: (l: number, a: number) => void
  stopTeleop: () => void
}) {
  const active = held.has(k)
  const press = () => { setHeld((p) => new Set(p).add(k)); startTeleop(l, a) }
  const release = () => { setHeld((p) => { const n = new Set(p); n.delete(k); return n }); stopTeleop() }
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); press() }}
      onMouseUp={release}
      onMouseLeave={() => { if (active) release() }}
      onTouchStart={(e) => { e.preventDefault(); press() }}
      onTouchEnd={release}
      className={`flex h-11 w-11 select-none items-center justify-center rounded-md border font-mono text-base font-bold shadow-sm transition-colors ${
        active
          ? 'border-blue-500 bg-blue-500 text-white shadow-none'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )
}

function LogPanel({ log }: { log: string[] }) {
  return (
    <PanelGrid cols={1}>
      <Subpanel title={`최근 액션 (${log.length})`}>
        {log.length === 0
          ? <p className="text-slate-400">아직 액션 없음</p>
          : (
            <ul className="space-y-0.5 font-mono text-sm leading-6 text-slate-700">
              {log.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
      </Subpanel>
    </PanelGrid>
  )
}

function HealthPanel({ health }: { health: any }) {
  const expected = (health.ros_expected_topics ?? {}) as Record<string, boolean>
  return (
    <PanelGrid cols={2}>
      <Subpanel title="서비스">
        <div className="font-mono">
          <KV k="adapter" v={health.adapter ?? 'down'}
              vClass={health.adapter === 'ok' ? 'text-emerald-600' : 'text-red-600'} />
          <KV k="sim" v={health.sim_alive ? 'up' : 'down'}
              vClass={health.sim_alive ? 'text-emerald-600' : 'text-red-600'} />
          <KV k="slam" v={health.slam_active ? 'active' : 'idle'}
              vClass={health.slam_active ? 'text-emerald-600' : 'text-slate-400'} />
          <KV k="explore" v={health.explore_active ? 'running' : 'idle'}
              vClass={health.explore_active ? 'text-emerald-600' : 'text-slate-400'} />
        </div>
        <a className="mt-3 inline-block rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
           href="ws://localhost:8765" target="_blank" rel="noreferrer">Foxglove ws://8765</a>
      </Subpanel>
      <Subpanel title={`ROS 토픽 (${Object.values(expected).filter(Boolean).length}/${Object.keys(expected).length} 활성)`}>
        <div className="space-y-1 text-sm leading-6">
          {Object.entries(expected).map(([t, ok]) => (
            <div key={t} className="flex items-center gap-2">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={ok ? 'text-slate-700' : 'text-slate-400'}>{t}</span>
            </div>
          ))}
        </div>
      </Subpanel>
    </PanelGrid>
  )
}

function DebugPanel({ health }: { health: any }) {
  return (
    <PanelGrid cols={2}>
      <Subpanel title="저장">
        <div className="font-mono">
          <KV k="rtabmap.db" v={
            <span className="truncate" title={health.rtabmap_db_path}>{health.rtabmap_db_path?.split('/').pop() ?? '—'}</span>
          } />
          <KV k="size" v={health.rtabmap_db_size_mb ? `${health.rtabmap_db_size_mb} MB` : '—'} />
          <KV k="floor_db_dir" v={
            <span className="truncate" title={health.floor_db_dir}>{health.floor_db_dir?.split('/').pop() ?? '—'}</span>
          } />
          <KV k="disk free" v={health.disk_free_gb ? `${health.disk_free_gb} GB` : '—'} />
        </div>
      </Subpanel>
      <Subpanel title="raw health JSON">
        <pre className="max-h-full overflow-auto rounded bg-slate-900 p-2 font-mono text-xs leading-5 text-emerald-300">
{JSON.stringify(health, null, 2)}
        </pre>
      </Subpanel>
    </PanelGrid>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h4>
}

// 모든 도크 탭 패널이 사용하는 표준 Subpanel: 헤딩 + 컨텐츠. 통일감 위해.
function Subpanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col">
      <h3 className="mb-2 border-b border-slate-200 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  )
}

// 다중 Subpanel 을 동일 폭 grid 로 배치. 모든 탭의 최상위 wrapper.
function PanelGrid({ cols, children }: { cols: number; children: React.ReactNode }) {
  const gridCols = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-4'
  return <div className={`grid h-full ${gridCols} gap-6`}>{children}</div>
}

// ── MapCanvas (light + nav click) ─────────────────────────────────────────
type LiveMeta = {
  width: number; height: number; resolution: number
  origin_x: number; origin_y: number; updated_at: number
}

function MapCanvas({
  pose, armed, goalPreview, onMapClickWorld,
}: {
  pose: any
  armed: boolean
  goalPreview: { x: number; y: number } | null
  onMapClickWorld: (x: number, y: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const lastDrag = useRef({ x: 0, y: 0 })
  const dragMoved = useRef(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [meta, setMeta] = useState<LiveMeta | null>(null)
  const [lastMsg, setLastMsg] = useState(0)
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 })

  // ResizeObserver — 컨테이너 크기 변경 시 캔버스 픽셀 크기 동기화.
  // (컨테이너 CSS 크기와 캔버스 내부 px 크기를 일치시켜 격자 왜곡 방지)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      setCanvasSize({ w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/map`
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingMeta: LiveMeta | null = null
    const connect = () => {
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => { timer = setTimeout(connect, 2000) }
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          pendingMeta = JSON.parse(ev.data) as LiveMeta
        } else {
          const blob = new Blob([ev.data as ArrayBuffer], { type: 'image/png' })
          const objUrl = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            imgRef.current = img
            if (pendingMeta) setMeta(pendingMeta)
            setLastMsg(Date.now())
            URL.revokeObjectURL(objUrl)
          }
          img.src = objUrl
        }
      }
    }
    connect()
    return () => { if (timer) clearTimeout(timer); ws?.close() }
  }, [])

  useEffect(() => { draw() }, [meta, pose, scale, offset, goalPreview, canvasSize])

  function worldFromCanvas(cx: number, cy: number): { x: number; y: number } | null {
    const c = canvasRef.current
    if (!c || !meta) return null
    const rect = c.getBoundingClientRect()
    const px = (cx - rect.left) * (c.width / rect.width)
    const py = (cy - rect.top) * (c.height / rect.height)
    const cxc = c.width / 2 + offset.x
    const cyc = c.height / 2 + offset.y
    const wx = (px - cxc) / (50 * scale) + (meta.origin_x + meta.width * meta.resolution / 2)
    const wy = -((py - cyc) / (50 * scale)) + (meta.origin_y + meta.height * meta.resolution / 2)
    return { x: wx, y: wy }
  }

  function draw() {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    // DPR 보정: c.width 는 px 단위 (DPR 곱), CSS 픽셀로 그려야 격자/선이 깔끔.
    const dpr = window.devicePixelRatio || 1
    const W = c.width / dpr
    const H = c.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)  // 한 번 스케일 적용
    ctx.clearRect(0, 0, W, H)
    // 라이트 배경 + 격자
    ctx.fillStyle = '#f1f5f9'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    const gridPx = 50 * scale
    for (let gx = (offset.x % gridPx + W / 2) % gridPx; gx < W; gx += gridPx) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke()
    }
    for (let gy = (offset.y % gridPx + H / 2) % gridPx; gy < H; gy += gridPx) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke()
    }
    if (!meta) return

    const px = 50 * scale
    const cx = W / 2 + offset.x
    const cy = H / 2 + offset.y
    const img = imgRef.current
    if (img) {
      const w = meta.width * meta.resolution * px
      const h = meta.height * meta.resolution * px
      const ox = cx - meta.width * meta.resolution * px / 2
      const oy = cy - meta.height * meta.resolution * px / 2
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, ox, oy, w, h)
    }

    const cwx = meta.origin_x + meta.width * meta.resolution / 2
    const cwy = meta.origin_y + meta.height * meta.resolution / 2

    if (pose?.available && pose.x != null && pose.y != null) {
      const px_x = cx + (pose.x - cwx) * px
      const px_y = cy - (pose.y - cwy) * px
      ctx.save()
      ctx.translate(px_x, px_y)
      ctx.rotate(-(pose.yaw_rad ?? 0))
      ctx.fillStyle = '#2563eb'
      ctx.beginPath()
      ctx.arc(0, 0, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(37, 99, 235, 0.18)'
      ctx.beginPath()
      const fov = Math.PI / 3, range = 5 * px
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, range, -fov / 2, fov / 2)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // Goal preview marker (target reticle)
    if (goalPreview) {
      const gx = cx + (goalPreview.x - cwx) * px
      const gy = cy - (goalPreview.y - cwy) * px
      ctx.save()
      ctx.translate(gx, gy)
      // 외부 링
      ctx.strokeStyle = '#1d4ed8'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke()
      // 십자
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.moveTo(0, -16); ctx.lineTo(0, 16); ctx.stroke()
      // 중앙 점
      ctx.fillStyle = '#1d4ed8'
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }

  const live = lastMsg > 0 && Date.now() - lastMsg < 5000
  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full ${armed ? 'cursor-crosshair' : 'cursor-grab'}`}
      onMouseDown={(e) => { setDragging(true); dragMoved.current = false; lastDrag.current = { x: e.clientX, y: e.clientY } }}
      onMouseLeave={() => setDragging(false)}
      onMouseMove={(e) => {
        if (!dragging) return
        const dx = e.clientX - lastDrag.current.x
        const dy = e.clientY - lastDrag.current.y
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true
        lastDrag.current = { x: e.clientX, y: e.clientY }
        setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
      }}
      onMouseUp={(e) => {
        setDragging(false)
        if (!dragMoved.current && armed) {
          const w = worldFromCanvas(e.clientX, e.clientY)
          if (w) onMapClickWorld(w.x, w.y)
        }
      }}
      onWheel={(e) => {
        e.preventDefault()
        setScale((s) => Math.max(0.1, Math.min(20, s * (e.deltaY < 0 ? 1.1 : 0.9))))
      }}
    >
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="block h-full w-full"
      />
      {/* armed dim overlay — 맵을 살짝 어둡게 + 강조 ring */}
      {armed && (
        <div className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-blue-400/60">
          <div className="absolute inset-0 bg-slate-950/15" />
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow">
            맵을 클릭해서 목적지 지정
          </div>
        </div>
      )}
      {!meta && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-sm text-slate-400">
          no map · SLAM 시작 시 표시
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/90 px-2 py-0.5 font-mono text-xs text-slate-500 backdrop-blur">
        {live ? <span className="text-emerald-600">●</span> : <span className="text-slate-300">○</span>}
        {' '}50px/m × {scale.toFixed(1)} · 휠=zoom 드래그=pan
        {armed && <span className="ml-2 text-blue-600">· 클릭=goal</span>}
      </div>
    </div>
  )
}
