import type { CurrentMapResponse, FloorPlan } from '../types/api'

function locationFill(type: string) {
  switch (type) {
    case 'LOBBY':
    case 'RECEPTION':
      return '#1d4ed8'
    case 'ELEVATOR':
      return '#7c3aed'
    case 'STORAGE':
      return '#0f766e'
    default:
      return '#1e293b'
  }
}

export function MapCanvas({
  floor,
  map,
}: {
  floor: FloorPlan
  map: CurrentMapResponse
}) {
  const floorRobots = map.robots.filter((robot) => robot.floorCode === floor.code)
  const floorTasks = map.activeTasks.filter((task) => task.floorCode === floor.code)
  const locationById = new Map(floor.locations.map((location) => [location.id, location]))

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950 shadow-[0_28px_70px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">{floor.name}</div>
          <div className="mt-1 text-xs text-slate-400">
            {map.name} · {map.version} · {map.scaleMetersPerPixel} m/px
          </div>
        </div>
        <div className="text-xs text-slate-400">
          {floorRobots.length} robots · {floorTasks.length} active tasks
        </div>
      </div>

      <div className="relative">
        <svg
          className="h-[520px] w-full bg-slate-950"
          preserveAspectRatio="xMidYMid meet"
          viewBox={floor.viewBox}
        >
          <defs>
            <pattern height="40" id={`grid-${floor.id}`} patternUnits="userSpaceOnUse" width="40">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </pattern>
          </defs>

          <rect fill={`url(#grid-${floor.id})`} height={floor.height} width={floor.width} x="0" y="0" />

          {floor.locations.map((location) => (
            <g key={location.id}>
              <rect
                fill={locationFill(location.type)}
                height={location.height}
                opacity={0.78}
                rx="10"
                stroke="rgba(148, 163, 184, 0.45)"
                strokeWidth="2"
                width={location.width}
                x={location.x}
                y={location.y}
              />
              <text
                fill="rgba(226,232,240,0.92)"
                fontFamily="Inter, sans-serif"
                fontSize="12"
                fontWeight="600"
                textAnchor="middle"
                x={location.x + location.width / 2}
                y={location.y + location.height / 2}
              >
                {location.name}
              </text>
            </g>
          ))}

          {floorTasks.map((task) => {
            const robot = floorRobots.find((candidate) => candidate.robotId === task.assignedRobotId)
            const destination = locationById.get(task.dropoffLocationId)

            if (!robot || !destination) {
              return null
            }

            return (
              <g key={task.id}>
                <line
                  opacity="0.65"
                  stroke="#60a5fa"
                  strokeDasharray="10 6"
                  strokeWidth="3"
                  x1={robot.x}
                  x2={destination.x + destination.width / 2}
                  y1={robot.y}
                  y2={destination.y + destination.height / 2}
                />
                <circle
                  cx={destination.x + destination.width / 2}
                  cy={destination.y + destination.height / 2}
                  fill="none"
                  r="12"
                  stroke="#34d399"
                  strokeDasharray="4 4"
                  strokeWidth="2"
                />
              </g>
            )
          })}

          {floorRobots.map((robot) => (
            <g key={robot.robotId}>
              <circle cx={robot.x} cy={robot.y} fill="rgba(59,130,246,0.24)" r="18" />
              <circle cx={robot.x} cy={robot.y} fill="#3b82f6" r="11" stroke="#93c5fd" strokeWidth="2" />
              <circle cx={robot.x} cy={robot.y} fill="white" r="3" />
              <g transform={`translate(${robot.x} ${robot.y}) rotate(${robot.yawDeg})`}>
                <polygon fill="#bfdbfe" points="0,-16 -5,-8 5,-8" />
              </g>
              <rect
                fill="#1d4ed8"
                height="22"
                opacity="0.96"
                rx="6"
                width="88"
                x={robot.x - 44}
                y={robot.y + 16}
              />
              <text
                fill="white"
                fontFamily="Inter, sans-serif"
                fontSize="10"
                fontWeight="700"
                textAnchor="middle"
                x={robot.x}
                y={robot.y + 30}
              >
                {robot.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
