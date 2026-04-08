export type RobotStatus =
  | 'IDLE'
  | 'NAVIGATING'
  | 'PLANNING'
  | 'PAUSED'
  | 'ERROR'
  | 'EMERGENCY_STOP'
  | 'OFFLINE'

export type TaskStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'RUNNING'
  | 'PAUSED'
  | 'DONE'
  | 'CANCELED'
  | 'FAILED'

export type Severity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'

export interface OperatorProfile {
  id: number
  name: string
  email: string
  role: string
  lastLoginAt: string | null
}

export interface LoginResponse {
  operator: OperatorProfile
}

export interface RobotState {
  status: RobotStatus
  batteryLevel: number
  online: boolean
  environment: string
  localizationState: string
  updatedAt: string
  warning: string | null
}

export interface RobotPose {
  x: number
  y: number
  yawDeg: number
  floorCode: string
  mapId: number
  mapName: string
}

export interface RobotSummary {
  id: number
  robotCode: string
  label: string
  serialNumber: string
  status: RobotStatus
  online: boolean
  batteryLevel: number
  floorCode: string
  floorName: string
  mapId: number
  mapName: string
  currentTaskId: number | null
  currentTaskCode: string | null
  updatedAt: string
  warning: string | null
  environment: string
  localizationState: string
}

export interface TaskSummary {
  id: number
  taskCode: string
  type: string
  status: TaskStatus
  priority: string
  floorCode: string
  pickupLocationName: string
  dropoffLocationName: string
  assignedRobotId: number | null
  assignedRobotLabel: string | null
  createdAt: string
  completedAt: string | null
  failureReason: string | null
  progressLabel: string
}

export interface TaskTimelineItem {
  key: string
  label: string
  state: 'done' | 'current' | 'pending'
  timestamp: string | null
}

export interface TaskDetail extends TaskSummary {
  currentStage: string
  currentStageLabel: string
  timeline: TaskTimelineItem[]
}

export interface CommandLog {
  id: number
  createdAt: string
  commandType: string
  parameters: string
  status: string
  issuedBy: string
}

export interface EventLog {
  id: number
  createdAt: string
  severity: Severity
  robotLabel: string | null
  type: string
  message: string
  taskCode: string | null
}

/** Matches backend LocationResponse: id, name, floorId, type, x, y */
export interface LocationReference {
  id: number
  name: string
  floorId: number
  type: string
  x: number
  y: number
}

/** Matches backend FloorResponse */
export interface FloorPlan {
  id: number
  code: string
  name: string
  orderIndex: number
  mapImageUrl: string | null
  mapPgmUrl?: string | null
  locations: LocationReference[]
}

export interface MapMetadata {
  id: number
  code: string
  name: string
  active: boolean
}

export interface MapRobot {
  robotId: number
  label: string
  status: RobotStatus
  batteryLevel: number
  floorCode: string
  x: number
  y: number
  yawDeg: number
  activeTaskCode: string | null
  destinationLocationId: number | null
}

export interface MapTask {
  id: number
  taskCode: string
  status: TaskStatus
  floorCode: string
  assignedRobotId: number | null
  assignedRobotLabel: string | null
  pickupLocationId: number
  dropoffLocationId: number
  progressLabel: string
}

/** Matches backend CurrentMapResponse */
export interface CurrentMapResponse extends MapMetadata {
  floors: FloorPlan[]
  robots: MapRobot[]
  activeTasks: MapTask[]
}

export interface RobotDetailResponse {
  robot: RobotSummary
  state: RobotState
  pose: RobotPose
  activeTask: TaskDetail | null
  commandHistory: CommandLog[]
  taskHistory: TaskSummary[]
  events: EventLog[]
}

export interface CreateTaskRequest {
  pickupLocationId: number
  dropoffLocationId: number
  priority: string
}

export interface DispatchCommandRequest {
  locationId: number
}

export interface RobotLabelRequest {
  label: string
}

export interface CreateRobotRequest {
  robotCode: string
  label: string
  mapId: number
  floorId: number
  poseX: number
  poseY: number
}

export interface InitialPoseRequest {
  x: number
  y: number
  yaw: number
}

export interface SlamSaveRequest {
  mapName: string
}

export interface SlamExploreStatus {
  exploreStatus: string
  [key: string]: unknown
}

export interface SetNav2YamlUrlRequest {
  nav2YamlUrl: string
}

export interface CreateMapRequest {
  code: string
  name: string
}

export interface CreateFloorRequest {
  mapId: number
  code: string
  name: string
  orderIndex?: number
}

