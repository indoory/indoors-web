import type { CurrentMapResponse, FloorPlan } from '../types/api'

export function MapCanvas({
  floor,
  map,
}: {
  floor: FloorPlan
  map: CurrentMapResponse
}) {
  const floorRobots = map.robots.filter((robot) => robot.floorCode === floor.code)
  const floorTasks = map.activeTasks.filter((task) => task.floorCode === floor.code)

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{floor.name}</h2>
          <span className="text-xs text-slate-400">{map.name}</span>
        </div>
        <span className="text-xs text-slate-500">
          {floorRobots.length} robots · {floorTasks.length} active tasks
        </span>
      </div>

      {floor.mapImageUrl ? (
        <div className="relative bg-slate-900">
          <img
            alt={`Floor map: ${floor.name}`}
            className="h-[480px] w-full object-contain"
            src={floor.mapImageUrl}
          />
          {/* Robot overlays — positioned using percentage of rendered image */}
          <div className="absolute bottom-3 right-3 flex items-center gap-3 rounded-lg bg-slate-800/90 px-3 py-2 text-[10px] text-slate-300 backdrop-blur">
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
              Robot
            </div>
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Goal
            </div>
            <div className="flex items-center gap-1 border-t-2 border-dashed border-blue-400 w-4" />
            Path
          </div>
        </div>
      ) : (
        <div className="relative h-80 bg-slate-900">
          {/* Grid overlay */}
          <svg className="absolute inset-0 h-full w-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern height="40" id={`grid-${floor.id}`} patternUnits="userSpaceOnUse" width="40">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect fill={`url(#grid-${floor.id})`} height="100%" width="100%" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            No map image uploaded for this floor
          </div>
        </div>
      )}
    </div>
  )
}
