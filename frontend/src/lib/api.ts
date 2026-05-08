import type {
  CreateTaskRequest,
  CurrentMapResponse,
  DispatchCommandRequest,
  EventLog,
  FloorPlan,
  InitialPoseRequest,
  LoginResponse,
  MapMetadata,
  OperatorProfile,
  RobotDetailResponse,
  RobotLabelRequest,
  RobotPose,
  RobotState,
  RobotSummary,
  SetNav2YamlUrlRequest,
  SlamExploreStatus,
  SlamSaveRequest,
  TaskDetail,
  TaskSummary,
  CreateRobotRequest,
  CreateMapRequest,
} from '../types/api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (response.status === 204) {
    return undefined as T
  }

  if (!response.ok) {
    const text = await response.text()
    throw new ApiError(text || 'Request failed', response.status)
  }

  return (await response.json()) as T
}

export function login(email: string, password: string) {
  return request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function logout() {
  return request<void>('/api/auth/logout', { method: 'POST' })
}

export function getMe() {
  return request<OperatorProfile>('/api/me')
}

export function getRobots() {
  return request<RobotSummary[]>('/api/robots')
}

export function getRobot(robotId: string) {
  return request<RobotDetailResponse>(`/api/robots/${robotId}`)
}

export function getRobotState(robotId: string) {
  return request<RobotState>(`/api/robots/${robotId}/state`)
}

export function getRobotPose(robotId: string) {
  return request<RobotPose>(`/api/robots/${robotId}/pose`)
}

export function getRobotTasks(robotId: string) {
  return request<TaskSummary[]>(`/api/robots/${robotId}/tasks`)
}

export function getRobotCommands(robotId: string) {
  return request(`/api/robots/${robotId}/commands`)
}

export function renameRobot(robotId: string, payload: RobotLabelRequest) {
  return request<RobotSummary>(`/api/robots/${robotId}/label`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function dispatchRobot(robotId: string, payload: DispatchCommandRequest) {
  return request<void>(`/api/robots/${robotId}/commands/dispatch`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function pauseRobot(robotId: string) {
  return request<void>(`/api/robots/${robotId}/commands/pause`, {
    method: 'POST',
  })
}

export function resumeRobot(robotId: string) {
  return request<void>(`/api/robots/${robotId}/commands/resume`, {
    method: 'POST',
  })
}

export function emergencyStopRobot(robotId: string) {
  return request<void>(`/api/robots/${robotId}/commands/emergency-stop`, {
    method: 'POST',
  })
}

export function getTasks() {
  return request<TaskSummary[]>('/api/tasks')
}

export function getTask(taskId: number | string) {
  return request<TaskDetail>(`/api/tasks/${taskId}`)
}

export function createTask(payload: CreateTaskRequest) {
  return request<TaskDetail>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function cancelTask(taskId: number | string) {
  return request<void>(`/api/tasks/${taskId}/cancel`, {
    method: 'PATCH',
  })
}

export function getMaps() {
  return request<MapMetadata[]>('/api/maps')
}

export function createMap(payload: CreateMapRequest) {
  return request<MapMetadata>('/api/maps', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getMap(mapId: number | string) {
  return request<CurrentMapResponse>(`/api/maps/${mapId}`)
}

export function deleteMap(mapId: number | string) {
  return request<void>(`/api/maps/${mapId}`, {
    method: 'DELETE',
  })
}

export function getFloors() {
  return request<FloorPlan[]>('/api/floors')
}

export function getEvents() {
  return request<EventLog[]>('/api/events')
}

export function getEvent(eventId: number | string) {
  return request<EventLog>(`/api/events/${eventId}`)
}

// ── Robots ──────────────────────────────────────────────────────────────────

export function createRobot(payload: CreateRobotRequest) {
  return request<RobotSummary>('/api/robots', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function setInitialPose(robotId: number | string, payload: InitialPoseRequest) {
  return request<void>(`/api/robots/${robotId}/initial-pose`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ── SLAM ────────────────────────────────────────────────────────────────────

export function startSlam(robotId: number | string) {
  return request<void>(`/api/robots/${robotId}/slam/start`, { method: 'POST' })
}

export function startSlamExplore(robotId: number | string) {
  return request<void>(`/api/robots/${robotId}/slam/explore/start`, { method: 'POST' })
}

export function getSlamExploreStatus(robotId: number | string) {
  return request<SlamExploreStatus>(`/api/robots/${robotId}/slam/explore/status`)
}

export function saveSlamMap(robotId: number | string, payload: SlamSaveRequest) {
  return request<void>(`/api/robots/${robotId}/slam/save`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function stopSlam(robotId: number | string) {
  return request<void>(`/api/robots/${robotId}/slam/stop`, { method: 'POST' })
}

// ── 멀티세션 SLAM (RTAB-Map) ────────────────────────────────────────────
export function setRobotFloor(robotId: number | string, floorId: number) {
  return request<{
    ok: boolean
    mode?: 'mapping' | 'localization'
    reason?: string
    floorCode?: string
    blobBytes?: number
    note?: string
  }>(`/api/robots/${robotId}/floor/set`, {
    method: 'POST',
    body: JSON.stringify({ floorId }),
  })
}

export function relocalizeRobot(robotId: number | string) {
  return request<{ converged: boolean; exit_code?: number; error?: string }>(
    `/api/robots/${robotId}/relocalize`,
    { method: 'POST' },
  )
}

export interface SystemHealth {
  adapter?: string
  bridge?: string
  sim_alive?: boolean
  slam_active?: boolean
  explore_active?: boolean
  sim_secs?: number
  rtabmap_db_path?: string
  rtabmap_db_size_mb?: number
  ros_topic_count?: number
  ros_expected_topics?: Record<string, boolean>
  disk_free_gb?: number
  floor_db_dir?: string
}

// 텔레옵 디바이스 (xlerobot SO-ARM101 leader 양 팔): 포트 enumerate + arm 별 connect/disconnect.
// 어댑터 직접 호출 — auth 불필요 (vite /api/system 프록시).
export type LeaderArm = 'left' | 'right'

export interface SerialPortInfo {
  device: string
  description: string
  hwid: string
  manufacturer: string
  product: string
  heldBy: LeaderArm | null  // 이미 잡힌 arm — 다른 arm 의 select 에서 disable
}

export async function listTeleopPorts(): Promise<SerialPortInfo[]> {
  const r = await fetch('/api/system/teleop/ports')
  if (!r.ok) throw new ApiError(await r.text(), r.status)
  const j = (await r.json()) as { ports: SerialPortInfo[] }
  return j.ports
}

export async function connectTeleopDevice(arm: LeaderArm, port: string, baudrate = 1_000_000) {
  const r = await fetch('/api/system/teleop/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arm, port, baudrate }),
  })
  if (!r.ok) throw new ApiError(await r.text(), r.status)
  return r.json() as Promise<{ ok: boolean; arm: LeaderArm; connected: boolean; port: string; baudrate: number }>
}

export async function disconnectTeleopDevice(arm: LeaderArm) {
  const r = await fetch('/api/system/teleop/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arm }),
  })
  if (!r.ok) throw new ApiError(await r.text(), r.status)
  return r.json() as Promise<{ ok: boolean; arm: LeaderArm; connected: boolean }>
}

export interface TeleopArmStatus {
  connected: boolean
  port: string | null
  baudrate: number | null
  error: string | null
}

export type TeleopDeviceStatus = Record<LeaderArm, TeleopArmStatus>

export async function getTeleopDeviceStatus(): Promise<TeleopDeviceStatus> {
  const r = await fetch('/api/system/teleop/status')
  if (!r.ok) throw new ApiError(await r.text(), r.status)
  return r.json()
}

// 텔레옵: linear m/s, angular rad/s. 어댑터 직접 호출 (vite /api/system 프록시).
export async function teleop(linear: number, angular: number) {
  // request() 가 /api 경로를 spring(8080) 으로 보내지 않고, vite proxy 가
  // /api/system/* 를 :8000 으로 라우팅하므로 fetch 직접 사용 (auth header 불필요).
  await fetch('/api/system/teleop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linear, angular }),
  })
}

export function getSystemHealth(robotId: number | string) {
  return request<SystemHealth>(`/api/robots/${robotId}/system/health`)
}

// "모르겠음" — Spring 거치지 않고 어댑터로 OCR floor 만 비움. 맵 / robot DB 미변경.
// vite proxy 룰: /api/system/* → adapter:8000. 다른 /api/* 는 Spring:8080.
export async function setOcrFloor(floorCode: string, mode: 'reject' | 'complete' = 'reject') {
  const r = await fetch('/api/system/semantic_ocr/floor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ floorCode, mode }),
  })
  if (!r.ok) throw new ApiError(await r.text(), r.status)
  return r.json() as Promise<{ ok: boolean; floorCode: string; mode: string }>
}

// 층 모를 때 임시 매핑 시작 — unknown_<ts>.db 별도 파일에 매핑. 기존
// ~/.ros/rtabmap.db 손상 0. 어댑터 직접 호출 (Spring DB 변경 없음 — 사용자가
// 나중에 "이건 5F 였어" 명시할 때 비로소 IndoorMap 으로 promote).
export async function startTempMapping() {
  const r = await fetch('/api/system/slam/start_temp', { method: 'POST' })
  if (!r.ok) throw new ApiError(await r.text(), r.status)
  return r.json() as Promise<{ ok: boolean; mode: string; temp_db_path: string; note: string }>
}

// 세션 시작: 사용자가 floor 입력. Spring 이 IndoorMap 자동 lookup/create + adapter
// rtabmap reload/fresh + OCR hint set + robot.mapId/floorId 갱신을 한 번에.
// 호출 후 ['robots'] / ['system-health'] 쿼리 invalidate 필요.
export async function startSession(robotId: number | string, floorCode: string) {
  return request<{
    ok: boolean
    mode: 'localization' | 'mapping' | 'mapping_fallback'
    floorCode: string
    floorId: number
    mapId: number
    mapName: string
  }>(`/api/robots/${robotId}/session/start`, {
    method: 'POST',
    body: JSON.stringify({ floorCode }),
  })
}

export function getLivePose(robotId: number | string) {
  return request<{
    available: boolean
    x?: number | null
    y?: number | null
    z?: number | null
    yaw_rad?: number | null
    yaw_deg?: number | null
    age_seconds?: number
    stale?: boolean
    raw?: string
    error?: string
  }>(`/api/robots/${robotId}/system/pose`)
}

export interface MapMeta {
  available: boolean
  width?: number
  height?: number
  resolution?: number
  origin_x?: number
  origin_y?: number
  age_seconds?: number
  reason?: string
}

export function getMapMeta() {
  return request<MapMeta>('/api/system/map')
}

// 맵 PNG URL — <img src=...> 로 직접 사용
export const MAP_PNG_URL = '/api/system/map.png'

// 새 SLAM 세션을 이름 붙여 저장 (Unknown → 명명된 맵). 현재는 거의 안 쓰임 — rename 으로 대체.
export function saveCurrentSession(payload: { name: string; code?: string }) {
  return request<{ id: number; code: string; name: string }>(`/api/maps/save-session`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Untitled draft 맵에 이름 부여 (= 영구 저장으로 승격)
export function renameMap(mapId: number, name: string) {
  return request<{ id: number; code: string; name: string }>(`/api/maps/${mapId}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

// 현재 draft 맵 폐기 (row + blob 삭제). 다음 fetch 시 새 Untitled 자동 생성.
export function discardMap(mapId: number) {
  return request<void>(`/api/maps/${mapId}/discard`, { method: 'DELETE' })
}

// 저장된 맵 로드 (Unknown 종료, robot.mapId 갱신)
export function loadSavedMap(robotId: number | string, mapId: number) {
  return request<{
    ok: boolean
    mode?: string
    mapId?: number
    mapName?: string
    blobBytes?: number
    reason?: string
  }>(`/api/robots/${robotId}/load-map`, {
    method: 'POST',
    body: JSON.stringify({ mapId }),
  })
}

export function listMaps() {
  return request<Array<{ id: number; code: string; name: string }>>('/api/maps')
}

// ── Maps ─────────────────────────────────────────────────────────────────────

export function setMapNav2YamlUrl(mapId: number | string, payload: SetNav2YamlUrlRequest) {
  return request<void>(`/api/maps/${mapId}/nav2-yaml-url`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
