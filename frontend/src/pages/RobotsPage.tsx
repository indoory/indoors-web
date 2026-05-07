import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight,
  Crosshair, Plug, RefreshCw, RotateCcw, Send, Square, Unplug,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { FloorPromptModal } from '../components/FloorPromptModal'
import { LoadingView } from '../components/LoadingView'
import {
  connectTeleopDevice, disconnectTeleopDevice,
  emergencyStopRobot, getLivePose, getMapMeta,
  getRobots, getSystemHealth, getTeleopDeviceStatus, listMaps, listTeleopPorts,
  loadSavedMap, pauseRobot, relocalizeRobot, renameMap, resumeRobot,
  setOcrFloor,
  startSlamExplore, stopSlam, teleop, type SystemHealth,
} from '../lib/api'

type LivePose = Awaited<ReturnType<typeof getLivePose>>
type MapMeta = Awaited<ReturnType<typeof getMapMeta>>

// /ws/pose WebSocket: 어댑터가 /odom 도착마다 push (~50Hz). HTTP poll 보다 훨씬 빠름.
// 반환: pose, sim_secs, connected, age_seconds 자동 계산.
type LivePoseExt = LivePose & { sim_secs?: number; updated_at?: number }
function useLivePose() {
  const [pose, setPose] = useState<LivePoseExt>({ available: false } as LivePoseExt)
  const [connected, setConnected] = useState(false)
  const [, force] = useState(0)
  // age_seconds 신선도를 1초마다 강제 재계산 (메시지 도착 안 해도 stale 표시)
  useEffect(() => { const id = setInterval(() => force((v) => v + 1), 1000); return () => clearInterval(id) }, [])
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/pose`
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const close = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { try { ws.close() } catch {}; ws = null }
      setConnected(false)
    }
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.onopen = () => setConnected(true)
      ws.onclose = () => { setConnected(false); if (!stopped && !document.hidden) timer = setTimeout(connect, 2000) }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        try { setPose(JSON.parse(ev.data)) } catch {}
      }
    }
    const onVis = () => { if (document.hidden) close(); else if (!ws || ws.readyState >= WebSocket.CLOSING) connect() }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVis); close() }
  }, [])
  // age 계산 (ws 가 끊겼더라도 마지막 도착 시각 기준)
  const ageSec = pose.updated_at ? (Date.now() / 1000 - pose.updated_at) : Infinity
  return {
    pose: { ...pose, age_seconds: Math.round(ageSec * 10) / 10, stale: ageSec > 2 },
    connected,
  }
}

type TabId = 'mapinfo' | 'action' | 'log' | 'health' | 'debug'
const TABS: { id: TabId; label: string }[] = [
  { id: 'mapinfo', label: '맵' },
  { id: 'action',  label: '조작' },
  { id: 'log',     label: '로그' },
  { id: 'health',  label: '헬스' },
  { id: 'debug',   label: '디버그' },
]

type ActionMode = 'idle' | 'goto-arming' | 'goto-placed' | 'goto-running' | 'reloc' | 'slam'

// 사이드/도크 크기는 localStorage 에 저장 → 새로고침 후 유지
const LS_SIDE = 'console.sideWidth'
const LS_DOCK = 'console.dockHeight'

export function RobotsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('mapinfo')
  const [dockOpen, setDockOpen] = useState(true)
  const [actionLog, setActionLog] = useState<string[]>([])
  const [actionMode, setActionMode] = useState<ActionMode>('idle')
  const [viewRotation, setViewRotation] = useState(0)  // 맵 캔버스 회전 (radians) — WASD 방향 변환용
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
  const healthQuery = useQuery<SystemHealth>({
    queryKey: ['system-health', robotId],
    queryFn: () => (robotId ? getSystemHealth(robotId) : Promise.resolve({} as SystemHealth)),
    enabled: !!robotId,
    // 1.5초마다 — slam/explore active 상태가 stop 직후 빠르게 idle 로 반영되게.
    refetchInterval: 1500,
  })
  // pose 는 /ws/pose WebSocket 으로 ~50Hz push 받음 (HTTP 1Hz 폴링 제거).
  const { pose, connected: poseConnected } = useLivePose()
  const mapMetaQuery = useQuery<MapMeta>({
    queryKey: ['map-meta'],
    queryFn: getMapMeta,
    refetchInterval: 3000,
  })

  // ROS 세션 watcher: poseConnected false→true 가 새 세션 시작.
  // robot.floorCode 가 채워져 있으면 자동 적용, 없으면 모달.
  // 끊겼다 다시 연결되면 askedThisSession 가 리셋되어 다시 묻는다.
  const [showFloorModal, setShowFloorModal] = useState(false)
  const [askedThisSession, setAskedThisSession] = useState(false)
  const lastConnectedRef = useRef(false)
  useEffect(() => {
    const wasConnected = lastConnectedRef.current
    lastConnectedRef.current = poseConnected
    if (wasConnected || !poseConnected) {
      if (!poseConnected) setAskedThisSession(false)
      return
    }
    // false → true 트랜지션
    if (askedThisSession) return
    if (robot?.floorCode) {
      setOcrFloor(robot.floorCode).catch(() => { /* 무시: param 서버 미준비 등 */ })
      setAskedThisSession(true)
    } else {
      setShowFloorModal(true)
    }
  }, [poseConnected, robot?.floorCode, askedThisSession])

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
  // 모든 이벤트 mutation: 클릭 즉시 mode 갱신 (optimistic) → 사용자 피드백 즉각.
  // 실패 시 mode 되돌림 (onError).
  const exploreMut = useMutation({
    mutationFn: async () => robotId ? startSlamExplore(robotId) : null,
    onMutate: () => { setActionMode('slam'); log('slam+explore 요청 중…') },
    onSuccess: () => { log('slam+explore started'); refresh() },
    onError: () => { setActionMode('idle'); log('slam start failed') },
  })
  const slamStopMut = useMutation({
    mutationFn: async () => robotId ? stopSlam(robotId) : null,
    onMutate: () => { log('slam stop 요청 중…') },
    onSuccess: () => { log('slam stopped'); setActionMode('idle'); refresh() },
    onError: () => { log('slam stop failed') },
  })
  const relocMut = useMutation({
    mutationFn: async () => robotId ? relocalizeRobot(robotId) : null,
    onMutate: () => { setActionMode('reloc'); log('reloc 시작…') },
    onSuccess: (r) => {
      if (r) log(r.converged ? 'relocalized' : `reloc failed: ${r.error ?? '?'}`)
      setActionMode('idle')
    },
    onError: () => { setActionMode('idle'); log('reloc failed') },
  })
  const cmd = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'estop') => {
      if (!robotId) return
      const id = String(robotId)
      if (action === 'pause') await pauseRobot(id)
      else if (action === 'resume') await resumeRobot(id)
      else if (action === 'estop') await emergencyStopRobot(id)
    },
    onSuccess: (_d, a) => { log(a); refresh() },
  })

  // 텔레옵 — WebSocket 기반. 어댑터 watchdog (300ms 무신호 시 자동 (0,0,0)) 으로 연결
  // 끊김/패킷 drop 시 robot 무한이동 방지.
  // holonomic 명령: lin (robot frame x +전진), ang (z +CCW), lat (y +좌측 평행이동).
  const teleopWsRef = useRef<WebSocket | null>(null)
  const teleopIntervalRef = useRef<number | null>(null)
  const teleopCmdRef = useRef<{ lin: number; ang: number; lat: number }>({ lin: 0, ang: 0, lat: 0 })

  // WS 연결 — 조작 탭 활성 시 단 한 번. 끊기면 자동 재연결.
  useEffect(() => {
    if (activeTab !== 'action' || !dockOpen) return
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/teleop`
    let stopped = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      if (stopped) return
      const ws = new WebSocket(url)
      teleopWsRef.current = ws
      ws.onclose = () => {
        teleopWsRef.current = null
        if (!stopped) reconnectTimer = setTimeout(connect, 1000)
      }
      ws.onerror = () => { /* close 가 이어서 호출됨 */ }
    }
    connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      const ws = teleopWsRef.current
      if (ws) {
        try { ws.send(JSON.stringify({ linear: 0, angular: 0, lateral: 0 })); ws.close() } catch {}
      }
      teleopWsRef.current = null
    }
  }, [activeTab, dockOpen])

  const sendTeleopCmd = (lin: number, ang: number, lat: number) => {
    const ws = teleopWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ linear: lin, angular: ang, lateral: lat })) } catch {}
    } else {
      // WS 미연결 (재연결 중) → HTTP fallback 1회. (드물게 발생, lateral 손실 감수)
      teleop(lin, ang).catch(() => {})
    }
  }

  const stopTeleop = useCallback(() => {
    if (teleopIntervalRef.current != null) {
      clearInterval(teleopIntervalRef.current)
      teleopIntervalRef.current = null
    }
    teleopCmdRef.current = { lin: 0, ang: 0, lat: 0 }
    sendTeleopCmd(0, 0, 0)
  }, [])

  const startTeleop = useCallback((linear: number, angular: number, lateral: number) => {
    teleopCmdRef.current = { lin: linear, ang: angular, lat: lateral }
    sendTeleopCmd(linear, angular, lateral)
    if (teleopIntervalRef.current != null) return  // 이미 keep-alive 돌고 있음
    // 어댑터 watchdog 이 300ms 안에 새 메시지 요구 → 100ms 마다 같은 cmd 보내 keep-alive.
    teleopIntervalRef.current = window.setInterval(() => {
      const c = teleopCmdRef.current
      if (c.lin === 0 && c.ang === 0 && c.lat === 0) {
        // 정지 상태면 더 보낼 필요 없음 → interval 정리
        if (teleopIntervalRef.current != null) {
          clearInterval(teleopIntervalRef.current)
          teleopIntervalRef.current = null
        }
        return
      }
      sendTeleopCmd(c.lin, c.ang, c.lat)
    }, 100) as unknown as number
  }, [])

  // WASD 핸들러 안에서 최신 pose/viewRotation 참조 위해 ref. 매번 effect 재등록 안 하게.
  const poseRef = useRef(pose)
  const viewRotRef = useRef(viewRotation)
  useEffect(() => { poseRef.current = pose }, [pose])
  useEffect(() => { viewRotRef.current = viewRotation }, [viewRotation])

  // 키 상태 — 키보드 + UI 버튼 공유. apply() 가 매 변경마다 실행해서 startTeleop.
  const pressedRef = useRef<Set<string>>(new Set())
  const applyTeleopRef = useRef(() => {})
  // 속도 조절: 사용자가 슬라이더로 변경 가능. ref 로도 잡아둬서 useEffect 의 apply()
  // 안에서 항상 최신 값 사용 (state closure 캡처 회피).
  const [linSpeed, setLinSpeed] = useState(3.0)   // m/s, 슬라이더 1~10
  const [angSpeed, setAngSpeed] = useState(3.0)   // rad/s, 슬라이더 1~10
  const linSpeedRef = useRef(linSpeed)
  const angSpeedRef = useRef(angSpeed)
  useEffect(() => { linSpeedRef.current = linSpeed }, [linSpeed])
  useEffect(() => { angSpeedRef.current = angSpeed }, [angSpeed])
  const pressKey = useCallback((k: 'w'|'a'|'s'|'d'|'q'|'r', down: boolean) => {
    if (down) pressedRef.current.add(k); else pressedRef.current.delete(k)
    applyTeleopRef.current()
  }, [])

  // 키 매핑 — 조작 탭 활성 시. e.code 사용 (한글/영어 자판 무관).
  //   W/S = 전진/후진 (linear.x)
  //   A/D = 좌/우 strafe (linear.y, holonomic 베이스만 의미)
  //   Q/R = 좌/우 회전 (angular.z, CCW/CW)
  // 속도는 슬라이더 (linSpeed / angSpeed) 로 실시간 조절.
  useEffect(() => {
    if (activeTab !== 'action' || !dockOpen) return
    const isText = (el: EventTarget | null) =>
      el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
    const CODE_TO_KEY: Record<string, string> = {
      KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyR: 'r',
    }
    const apply = () => {
      const pressed = pressedRef.current
      if (pressed.size === 0) { stopTeleop(); return }
      const LIN = linSpeedRef.current
      const ANG = angSpeedRef.current
      let lin = 0, lat = 0, ang = 0
      if (pressed.has('w')) lin += LIN
      if (pressed.has('s')) lin -= LIN
      if (pressed.has('a')) lat += LIN   // 왼쪽 strafe
      if (pressed.has('d')) lat -= LIN   // 오른쪽 strafe
      if (pressed.has('q')) ang += ANG   // 좌회전 (CCW)
      if (pressed.has('r')) ang -= ANG   // 우회전 (CW)
      // (linear, angular, lateral)
      startTeleop(lin, ang, lat)
    }
    applyTeleopRef.current = apply
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (isText(e.target)) return
      const k = CODE_TO_KEY[e.code]
      if (!k) return
      e.preventDefault()
      pressKey(k as 'w'|'a'|'s'|'d'|'q'|'r', down)
    }
    const dn = (e: KeyboardEvent) => onKey(e, true)
    const up = (e: KeyboardEvent) => onKey(e, false)
    const onBlur = () => { pressedRef.current.clear(); stopTeleop() }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', onBlur)
      pressedRef.current.clear()
      stopTeleop()
    }
  }, [activeTab, dockOpen, startTeleop, stopTeleop])

  // 진행 중 이벤트 강제 정지: reloc spin 프로세스 + Nav2 goal cancel + cmd_vel (0,0).
  // useCallback 은 early return 뒤에 두면 hook 순서 어긋남 → 모든 useEffect/useCallback
  // 은 early return 이전에 위치해야 함 (Rules of Hooks).
  const cancelEvent = useCallback(() => {
    fetch('/api/system/cancel_event', { method: 'POST' })
      .then(() => log('event canceled'))
      .catch(() => log('cancel fail'))
    setActionMode('idle')
    setGoalPreview(null)
  }, [log])

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
    // 발행 → running 상태 (Nav2 가 실행 중. 사용자가 정지 가능)
    setActionMode('goto-running')
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
                eventIdle={actionMode === 'idle'}
                rotation={viewRotation}
                setRotation={setViewRotation}
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
                  onCancelEvent={cancelEvent}
                  pressKey={pressKey}
                  stopTeleop={stopTeleop}
                  linSpeed={linSpeed}
                  angSpeed={angSpeed}
                  setLinSpeed={setLinSpeed}
                  setAngSpeed={setAngSpeed}
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
          <span className={poseConnected ? 'text-emerald-600' : 'text-red-500'}>
            ws {poseConnected ? 'connected' : 'disconnected'}
          </span>
          <span>·</span>
          <span>topics {Object.values(health.ros_expected_topics ?? {}).filter(Boolean).length}/{Object.keys(health.ros_expected_topics ?? {}).length}</span>
          <span>·</span>
          <span>map {mapMeta?.available ? `${mapMeta.width}×${mapMeta.height}` : '—'}</span>
          <span>·</span>
          <span className={pose.stale ? 'text-amber-600' : ''}>
            pose {pose.available ? `${pose.age_seconds}s` : '—'}
          </span>
          <span className="ml-auto">
            sim t={pose.sim_secs ? pose.sim_secs.toFixed(1) : (health.sim_secs?.toFixed(1) ?? '—')}s
          </span>
        </div>
      </div>
      {showFloorModal ? (
        <FloorPromptModal
          onClose={() => { setShowFloorModal(false); setAskedThisSession(true) }}
        />
      ) : null}
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
    // 탭이 hidden 일 때는 WS 끊어 카메라 stream 자체를 멈춤 (대역폭 절약).
    // 다시 visible 되면 재연결. 서버는 새로 push 시작.
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/camera`
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const close = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws) { try { ws.close() } catch {} ; ws = null }
    }
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => {
        if (stopped || document.hidden) return
        reconnectTimer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (document.hidden) return  // 안전 가드 (close 사이 race)
        if (ev.data instanceof ArrayBuffer) {
          const blob = new Blob([ev.data], { type: 'image/jpeg' })
          setImgUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
          setLastFrame(Date.now())
        }
      }
    }
    const onVis = () => {
      if (document.hidden) close()
      else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      close()
    }
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
  onReloc, onSlamStart, onSlamStop, onCancelEvent,
  pressKey, stopTeleop,
  linSpeed, angSpeed, setLinSpeed, setAngSpeed,
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
  onCancelEvent: () => void
  pressKey: (k: 'w'|'a'|'s'|'d'|'q'|'r', down: boolean) => void
  stopTeleop: () => void
  linSpeed: number
  angSpeed: number
  setLinSpeed: (v: number) => void
  setAngSpeed: (v: number) => void
}) {
  const slamRunning = mode === 'slam' || exploreActive
  const relocRunning = mode === 'reloc' || relocPending
  const gotoArmed = mode === 'goto-arming' || mode === 'goto-placed'
  const gotoRunning = mode === 'goto-running'
  return (
    <PanelGrid cols={3}>
      <Subpanel title="이벤트 발행">
        <div className="flex flex-col gap-2">
        <ActionRow
          icon={<Crosshair className="h-4 w-4" />}
          label="목적지 이동"
          accent="blue"
          active={gotoArmed || gotoRunning}
          disabled={mode !== 'idle' && !gotoArmed && !gotoRunning}
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
          {gotoRunning && (
            <>
              <span className="text-xs text-blue-700">● 이동 중</span>
              <button type="button" onClick={onCancelEvent}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                정지
              </button>
            </>
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
          {relocRunning && (
            <>
              <span className="text-xs text-purple-700">⟳ 회전 중…</span>
              <button type="button" onClick={onCancelEvent}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                정지
              </button>
            </>
          )}
        </ActionRow>

        <ActionRow
          icon={<Send className="h-4 w-4" />}
          label="자율 탐사"
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

      <Subpanel title="수동 조작 (WASD + QR)">
        <div className="flex flex-col items-start gap-2">
          <ManualTeleop
            pressKey={pressKey}
            stopTeleop={stopTeleop}
            linSpeed={linSpeed}
            angSpeed={angSpeed}
            setLinSpeed={setLinSpeed}
            setAngSpeed={setAngSpeed}
          />
          <p className="text-xs leading-snug text-slate-500">
            W/S = 전진/후진 · A/D = 좌/우 strafe · Q/R = 좌/우 회전<br/>
            <span className="text-slate-400">키 release = 정지. 슬라이더로 속도 조절.</span>
          </p>
        </div>
      </Subpanel>

      <Subpanel title="텔레옵 디바이스 (포트 연결)">
        <TeleopDeviceConnector />
      </Subpanel>
    </PanelGrid>
  )
}

// xlerobot 모터 버스 / so101 leader / serial 입력 디바이스를 어댑터에 연결.
// 어댑터는 직렬 포트 open/close 만 담당 — 디바이스 프로토콜 → cmd_vel 브리지는 별도 단계.
function TeleopDeviceConnector() {
  const queryClient = useQueryClient()
  const portsQuery = useQuery({
    queryKey: ['teleop-ports'],
    queryFn: listTeleopPorts,
    refetchInterval: 5000,  // USB hot-plug 자동 반영
    refetchOnWindowFocus: true,
  })
  const statusQuery = useQuery({
    queryKey: ['teleop-device-status'],
    queryFn: getTeleopDeviceStatus,
    refetchInterval: 3000,
  })
  const ports = portsQuery.data ?? []
  const status = statusQuery.data
  const connected = !!status?.connected

  const [selectedPort, setSelectedPort] = useState<string>('')
  const [baudrate, setBaudrate] = useState<number>(1_000_000)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // 포트 목록 첫 로드 시 첫 번째 포트 자동 선택. 이미 연결된 포트가 있으면 그걸 우선.
  useEffect(() => {
    if (connected && status?.port) {
      setSelectedPort(status.port)
      if (status.baudrate) setBaudrate(status.baudrate)
      return
    }
    if (!selectedPort && ports.length > 0) setSelectedPort(ports[0].device)
  }, [ports, connected, status?.port, status?.baudrate, selectedPort])

  const connectMut = useMutation({
    mutationFn: () => connectTeleopDevice(selectedPort, baudrate),
    onSuccess: () => {
      setErrMsg(null)
      queryClient.invalidateQueries({ queryKey: ['teleop-device-status'] })
    },
    onError: (e: unknown) => setErrMsg(e instanceof Error ? e.message : '연결 실패'),
  })
  const disconnectMut = useMutation({
    mutationFn: () => disconnectTeleopDevice(),
    onSuccess: () => {
      setErrMsg(null)
      queryClient.invalidateQueries({ queryKey: ['teleop-device-status'] })
    },
    onError: (e: unknown) => setErrMsg(e instanceof Error ? e.message : '해제 실패'),
  })

  const busy = connectMut.isPending || disconnectMut.isPending

  return (
    <div className="flex flex-col gap-2 text-sm">
      {/* 포트 dropdown + 새로고침 */}
      <div className="flex items-center gap-1.5">
        <select
          value={selectedPort}
          onChange={(e) => setSelectedPort(e.target.value)}
          disabled={connected || busy}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs disabled:bg-slate-100 disabled:text-slate-500"
        >
          {ports.length === 0 && <option value="">— 포트 없음 —</option>}
          {ports.map((p) => (
            <option key={p.device} value={p.device}>
              {p.device}{p.product ? ` · ${p.product}` : p.description ? ` · ${p.description}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => portsQuery.refetch()}
          disabled={portsQuery.isFetching}
          title="포트 새로고침"
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${portsQuery.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* baudrate */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">baud</span>
        <select
          value={baudrate}
          onChange={(e) => setBaudrate(parseInt(e.target.value, 10))}
          disabled={connected || busy}
          className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs disabled:bg-slate-100 disabled:text-slate-500"
        >
          <option value={1000000}>1,000,000 (Feetech)</option>
          <option value={500000}>500,000</option>
          <option value={115200}>115,200</option>
          <option value={57600}>57,600</option>
          <option value={9600}>9,600</option>
        </select>
      </div>

      {/* 연결/해제 버튼 + 상태 */}
      <div className="flex items-center gap-2">
        {!connected ? (
          <button
            type="button"
            onClick={() => connectMut.mutate()}
            disabled={!selectedPort || busy}
            className="flex h-8 items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plug className="h-3.5 w-3.5" />
            {connectMut.isPending ? '연결 중…' : '연결'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => disconnectMut.mutate()}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Unplug className="h-3.5 w-3.5" />
            {disconnectMut.isPending ? '해제 중…' : '해제'}
          </button>
        )}
        <span className={`flex items-center gap-1 text-xs ${connected ? 'text-emerald-600' : 'text-slate-400'}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          {connected ? '연결됨' : '미연결'}
        </span>
      </div>

      {connected && status?.port && (
        <div className="font-mono text-xs text-slate-500">
          {status.port} @ {status.baudrate?.toLocaleString()}
        </div>
      )}
      {errMsg && (
        <p className="break-all text-xs leading-snug text-red-600">{errMsg}</p>
      )}
      <p className="text-xs leading-snug text-slate-400">
        xlerobot 모터 버스 / so101 leader 등 직렬 디바이스. 연결 후 디바이스 프로토콜 브리지는 다음 단계.
      </p>
    </div>
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

type TeleopKey = 'w'|'a'|'s'|'d'|'q'|'r'

function ManualTeleop({
  pressKey, stopTeleop, linSpeed, angSpeed, setLinSpeed, setAngSpeed,
}: {
  pressKey: (k: TeleopKey, down: boolean) => void
  stopTeleop: () => void
  linSpeed: number
  angSpeed: number
  setLinSpeed: (v: number) => void
  setAngSpeed: (v: number) => void
}) {
  // 키캡 시각 highlight + 슬라이더 (선/각속도). 실제 명령은 부모 pressKey/apply 처리.
  const [held, setHeld] = useState<Set<string>>(new Set())
  useEffect(() => {
    const isText = (el: EventTarget | null) =>
      el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
    const CODE_TO_KEY: Record<string, string> = {
      KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyR: 'r',
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
    <div className="flex flex-col gap-3">
      {/* 키캡:  Q W R          */}
      {/*        A S D          */}
      <div className="inline-flex flex-col items-center gap-1">
        <div className="flex gap-1">
          <KeyCap k="q" label="Q" held={held} setHeld={setHeld} pressKey={pressKey} stopTeleop={stopTeleop} />
          <KeyCap k="w" label="W" held={held} setHeld={setHeld} pressKey={pressKey} stopTeleop={stopTeleop} />
          <KeyCap k="r" label="R" held={held} setHeld={setHeld} pressKey={pressKey} stopTeleop={stopTeleop} />
        </div>
        <div className="flex gap-1">
          <KeyCap k="a" label="A" held={held} setHeld={setHeld} pressKey={pressKey} stopTeleop={stopTeleop} />
          <KeyCap k="s" label="S" held={held} setHeld={setHeld} pressKey={pressKey} stopTeleop={stopTeleop} />
          <KeyCap k="d" label="D" held={held} setHeld={setHeld} pressKey={pressKey} stopTeleop={stopTeleop} />
        </div>
      </div>
      {/* 속도 슬라이더 — 1~10 범위, 기본 3 */}
      <div className="flex flex-col gap-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="w-20 text-slate-600">선속도</span>
          <input
            type="range" min={1} max={10} step={0.5}
            value={linSpeed}
            onChange={(e) => setLinSpeed(parseFloat(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-16 text-right font-mono tabular-nums text-slate-700">
            {linSpeed.toFixed(1)} m/s
          </span>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20 text-slate-600">각속도</span>
          <input
            type="range" min={1} max={10} step={0.5}
            value={angSpeed}
            onChange={(e) => setAngSpeed(parseFloat(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-16 text-right font-mono tabular-nums text-slate-700">
            {angSpeed.toFixed(1)} rad/s
          </span>
        </label>
      </div>
    </div>
  )
}

// KeyCap 외부 정의 — 매 렌더마다 새 컴포넌트 안 만들어 unmount/remount 회피.
function KeyCap({
  k, label, held, setHeld, pressKey, stopTeleop,
}: {
  k: TeleopKey
  label: string
  held: Set<string>
  setHeld: React.Dispatch<React.SetStateAction<Set<string>>>
  pressKey: (k: TeleopKey, down: boolean) => void
  stopTeleop: () => void
}) {
  const active = held.has(k)
  const press = () => { setHeld((p) => new Set(p).add(k)); pressKey(k, true) }
  const release = () => {
    setHeld((p) => { const n = new Set(p); n.delete(k); return n })
    pressKey(k, false)
    // 모든 키 release 시 부모의 apply 가 stopTeleop 호출 — 여기선 추가 stop 불필요.
    void stopTeleop
  }
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
  pose, armed, goalPreview, onMapClickWorld, eventIdle, rotation, setRotation,
}: {
  pose: any
  armed: boolean
  goalPreview: { x: number; y: number } | null
  onMapClickWorld: (x: number, y: number) => void
  eventIdle: boolean
  rotation: number
  setRotation: React.Dispatch<React.SetStateAction<number>>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [tilt, setTilt] = useState(0)  // degrees, 0=탑뷰 / 60=거의 옆에서
  const [dragging, setDragging] = useState<'pan' | 'rotate' | 'tilt' | null>(null)
  const lastDrag = useRef({ x: 0, y: 0 })
  const dragMoved = useRef(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [meta, setMeta] = useState<LiveMeta | null>(null)
  const [lastMsg, setLastMsg] = useState(0)
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 })

  const resetView = useCallback(() => {
    setScale(1); setOffset({ x: 0, y: 0 }); setRotation(0); setTilt(0)
  }, [])
  const [path, setPath] = useState<Array<[number, number]>>([])
  const [frontiers, setFrontiers] = useState<Array<[number, number]>>([])
  const [show3D, setShow3D] = useState(false)  // nvblox cloud overlay 토글
  const cloudRef = useRef<Float32Array | null>(null)
  const [cloudCount, setCloudCount] = useState(0)

  // 이벤트 종료 (idle 진입) 시 경로/프론티어 잔재 청소.
  useEffect(() => {
    if (eventIdle) { setPath([]); setFrontiers([]) }
  }, [eventIdle])

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
    // 카메라와 동일 패턴: 탭 hidden 시 WS 끊어 server 가 push 멈추게.
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/map`
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pendingMeta: LiveMeta | null = null
    let stopped = false
    const close = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws) { try { ws.close() } catch {} ; ws = null }
    }
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => {
        if (stopped || document.hidden) return
        reconnectTimer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (document.hidden) return
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
    const onVis = () => {
      if (document.hidden) close()
      else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      close()
    }
  }, [])

  // /ws/path — Nav2 /plan 라이브 폴리라인 (이벤트 진행 중에만 publish 됨).
  // 카메라/맵과 같은 visibility-aware 패턴.
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/path`
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const close = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws) { try { ws.close() } catch {}; ws = null }
    }
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.onclose = () => {
        if (stopped || document.hidden) return
        reconnectTimer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        try {
          const msg = JSON.parse(ev.data) as { points: Array<[number, number]> }
          setPath(msg.points || [])
        } catch {}
      }
    }
    const onVis = () => {
      if (document.hidden) close()
      else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      close()
    }
  }, [])

  // /ws/cloud — nvblox PointCloud2 → Float32Array(x,y,z 반복). show3D 일 때만 연결.
  useEffect(() => {
    if (!show3D) {
      cloudRef.current = null
      setCloudCount(0)
      return
    }
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/cloud`
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const close = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { try { ws.close() } catch {}; ws = null }
    }
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => {
        if (stopped || document.hidden) return
        timer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return
        cloudRef.current = new Float32Array(ev.data)
        setCloudCount(cloudRef.current.length / 3 | 0)
      }
    }
    const onVis = () => {
      if (document.hidden) close()
      else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      close()
    }
  }, [show3D])

  // /ws/frontiers — explore_lite frontier 후보 (자율 탐사 진행 중일 때만 채워짐)
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/frontiers`
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const close = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { try { ws.close() } catch {}; ws = null }
    }
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.onclose = () => {
        if (stopped || document.hidden) return
        timer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        try {
          const msg = JSON.parse(ev.data) as { points: Array<[number, number]> }
          setFrontiers(msg.points || [])
        } catch {}
      }
    }
    const onVis = () => {
      if (document.hidden) close()
      else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      close()
    }
  }, [])

  useEffect(() => { draw() }, [meta, pose, scale, offset, rotation, goalPreview, canvasSize, path, frontiers, cloudCount, show3D])

  // CSS 픽셀 기준 + rotation 역변환. draw() 의 변환 순서: translate(center) → rotate(rot)
  // → scale → drawImage(world). 따라서 역변환: 클릭 px → 중심 빼기 → rotate(-rot) →
  // scale 나누기 → world offset 더하기.
  function worldFromCanvas(cx: number, cy: number): { x: number; y: number } | null {
    const c = canvasRef.current
    if (!c || !meta) return null
    const rect = c.getBoundingClientRect()
    const px = cx - rect.left
    const py = cy - rect.top
    const cxc = rect.width / 2 + offset.x
    const cyc = rect.height / 2 + offset.y
    // 캔버스 상 클릭 → 회전 적용된 좌표계의 좌표.
    let dx = px - cxc
    let dy = py - cyc
    // 역회전 (-rotation)
    const cs = Math.cos(-rotation), sn = Math.sin(-rotation)
    const rx = dx * cs - dy * sn
    const ry = dx * sn + dy * cs
    const wx = rx / (50 * scale) + (meta.origin_x + meta.width * meta.resolution / 2)
    const wy = -ry / (50 * scale) + (meta.origin_y + meta.height * meta.resolution / 2)
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

    // 회전: 격자 제외 모든 콘텐츠 (맵/path/frontier/pose/goal) 를 (cx,cy) 중심으로 회전.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rotation)
    ctx.translate(-cx, -cy)

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

    // nvblox 3D pointcloud — show3D 토글 시 z (높이) 별 색상 그라데이션 점.
    // 회색 격자 위, 맵 이미지 아래에 그려도 되지만 가독성 위해 path 와 비슷한 위치.
    const cloud = cloudRef.current
    if (cloud && cloud.length >= 3) {
      ctx.save()
      const n = (cloud.length / 3) | 0
      // 점 크기는 줌에 비례 (가까이 보면 큼)
      const r = Math.max(1, 2 * scale)
      // z 범위 추정 (한 번만 — 전체 색상화)
      let zmin = Infinity, zmax = -Infinity
      for (let i = 0; i < n; i++) {
        const z = cloud[i * 3 + 2]
        if (z < zmin) zmin = z
        if (z > zmax) zmax = z
      }
      const zspan = Math.max(0.1, zmax - zmin)
      for (let i = 0; i < n; i++) {
        const wx = cloud[i * 3]
        const wy = cloud[i * 3 + 1]
        const z  = cloud[i * 3 + 2]
        const sx = cx + (wx - cwx) * px
        const sy = cy - (wy - cwy) * px
        // viridis-ish: 낮으면 파랑, 높으면 노랑
        const t = (z - zmin) / zspan  // 0..1
        const cr = Math.round(70 + 185 * t)
        const cg = Math.round(40 + 200 * t)
        const cb = Math.round(180 - 140 * t)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.5)`
        ctx.fillRect(sx - r / 2, sy - r / 2, r, r)
      }
      ctx.restore()
    }

    // explore_lite frontier 후보 — 자율 탐사 중 미탐색 영역. 초록 점.
    if (frontiers.length > 0) {
      ctx.save()
      ctx.fillStyle = 'rgba(16, 185, 129, 0.85)'
      ctx.strokeStyle = '#047857'
      ctx.lineWidth = 1.5
      for (const [wx, wy] of frontiers) {
        const sx = cx + (wx - cwx) * px
        const sy = cy - (wy - cwy) * px
        ctx.beginPath()
        ctx.arc(sx, sy, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }

    // Nav2 /plan 경로 — 진행 중 이벤트의 계획된 path 폴리라인.
    if (path.length > 1) {
      ctx.save()
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(37, 99, 235, 0.35)'
      ctx.shadowBlur = 6
      ctx.beginPath()
      let first = true
      for (const [wx, wy] of path) {
        const sx = cx + (wx - cwx) * px
        const sy = cy - (wy - cwy) * px
        if (first) { ctx.moveTo(sx, sy); first = false }
        else ctx.lineTo(sx, sy)
      }
      ctx.stroke()
      // 끝점 작은 dot
      const [ex, ey] = path[path.length - 1]
      ctx.shadowBlur = 0
      ctx.fillStyle = '#1d4ed8'
      ctx.beginPath()
      ctx.arc(cx + (ex - cwx) * px, cy - (ey - cwy) * px, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

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

    // 회전 transform 종료
    ctx.restore()
  }

  const live = lastMsg > 0 && Date.now() - lastMsg < 5000
  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full ${armed ? 'cursor-crosshair' : dragging === 'rotate' ? 'cursor-ew-resize' : 'cursor-grab'}`}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => {
        // 좌클릭=pan, 우클릭/Shift=회전, 중간(휠)클릭/Ctrl=3D 기울기
        let mode: 'pan' | 'rotate' | 'tilt' = 'pan'
        if (e.button === 1 || e.ctrlKey) mode = 'tilt'
        else if (e.button === 2 || e.shiftKey) mode = 'rotate'
        if (mode === 'tilt') e.preventDefault()  // 휠클릭 기본 스크롤 방지
        setDragging(mode)
        dragMoved.current = false
        lastDrag.current = { x: e.clientX, y: e.clientY }
      }}
      onMouseLeave={() => setDragging(null)}
      onMouseMove={(e) => {
        if (!dragging) return
        const dx = e.clientX - lastDrag.current.x
        const dy = e.clientY - lastDrag.current.y
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true
        lastDrag.current = { x: e.clientX, y: e.clientY }
        if (dragging === 'rotate') {
          setRotation((r) => r + dx * 0.01)
        } else if (dragging === 'tilt') {
          // 세로 드래그 = 3D 기울기 (위 = 더 기울임). 0~60deg clamp.
          setTilt((t) => Math.max(0, Math.min(60, t + dy * 0.3)))
        } else {
          setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
        }
      }}
      onMouseUp={(e) => {
        setDragging(null)
        if (!dragMoved.current && armed && e.button === 0) {
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
        style={{
          // 3D 기울기 — 탑뷰 (0deg) ~ 60deg. perspective 로 입체감.
          transform: tilt !== 0 ? `perspective(1500px) rotateX(${tilt}deg)` : undefined,
          transformOrigin: 'center center',
          transition: dragging === 'tilt' ? 'none' : 'transform 0.15s ease-out',
        }}
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
      {/* 우상단 컨트롤: 3D 메쉬 토글 + 탑뷰 리셋 + 회전/기울기 각도 */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        {rotation !== 0 && (
          <span className="rounded bg-white/90 px-2 py-1 font-mono text-xs text-slate-600 backdrop-blur">
            ↻ {((rotation * 180) / Math.PI).toFixed(0)}°
          </span>
        )}
        {tilt !== 0 && (
          <span className="rounded bg-white/90 px-2 py-1 font-mono text-xs text-slate-600 backdrop-blur">
            ⌒ {tilt.toFixed(0)}°
          </span>
        )}
        <button
          type="button"
          onClick={() => setShow3D((v) => !v)}
          title="nvblox scene mesh overlay (실험)"
          className={`rounded border px-2 py-1 text-xs font-medium ${
            show3D
              ? 'border-emerald-400 bg-emerald-500 text-white hover:bg-emerald-600'
              : 'border-slate-300 bg-white/90 text-slate-700 hover:bg-white'
          }`}
        >
          3D
        </button>
        <button
          type="button"
          onClick={resetView}
          title="탑뷰로 (회전·줌·이동·기울기 리셋)"
          className="rounded border border-slate-300 bg-white/90 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
        >
          탑뷰
        </button>
      </div>
      {/* 3D pointcloud 활성 표시 */}
      {show3D && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-emerald-50/95 border border-emerald-300 px-2 py-1 text-xs text-emerald-800 shadow-sm">
          3D cloud · {cloudCount.toLocaleString()} pts
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/90 px-2 py-0.5 font-mono text-xs text-slate-500 backdrop-blur">
        {live ? <span className="text-emerald-600">●</span> : <span className="text-slate-300">○</span>}
        {' '}50px/m × {scale.toFixed(1)} · 휠=줌 좌드래그=이동 우/Shift=회전 휠클릭/Ctrl=기울기
        {armed && <span className="ml-2 text-blue-600">· 클릭=goal</span>}
      </div>
    </div>
  )
}
