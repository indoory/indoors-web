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

export function getCurrentMap() {
  return request<CurrentMapResponse>('/api/maps/current')
}

export function getMap(mapId: number | string) {
  return request<CurrentMapResponse>(`/api/maps/${mapId}`)
}

export function activateMap(mapId: number | string) {
  return request<void>(`/api/maps/${mapId}/activate`, {
    method: 'PATCH',
  })
}

export function loadMap(mapId: number | string) {
  return request<void>('/api/maps/load', {
    method: 'POST',
    body: JSON.stringify({ mapId }),
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

// ── Maps ─────────────────────────────────────────────────────────────────────

export function setMapNav2YamlUrl(mapId: number | string, payload: SetNav2YamlUrlRequest) {
  return request<void>(`/api/maps/${mapId}/nav2-yaml-url`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
