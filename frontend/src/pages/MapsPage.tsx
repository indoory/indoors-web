import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { MapCanvas } from '../components/MapCanvas'
import { StatusBadge } from '../components/StatusBadge'
import { getCurrentMap } from '../lib/api'

export function MapsPage() {
  const mapQuery = useQuery({
    queryKey: ['map', 'current'],
    queryFn: getCurrentMap,
    refetchInterval: 5_000,
  })
  const [floorCode, setFloorCode] = useState('')

  const map = mapQuery.data
  const activeFloorCode = floorCode || map?.floors[0]?.code || ''
  const currentFloor = map?.floors.find((floor) => floor.code === activeFloorCode) ?? map?.floors[0]
  const floorRobots = map?.robots.filter((robot) => robot.floorCode === currentFloor?.code) ?? []
  const floorTasks = map?.activeTasks.filter((task) => task.floorCode === currentFloor?.code) ?? []
  const locationById = new Map(currentFloor?.locations.map((location) => [location.id, location]) ?? [])

  return (
    <AppShell
      subtitle="Semantic floor view with robot positions and active task destinations."
      title="Maps"
    >
      {mapQuery.isLoading || !map || !currentFloor ? (
        <LoadingView compact label="Loading semantic map..." />
      ) : null}

      {map && currentFloor ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {map.floors.map((floor) => (
                <button
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    currentFloor.code === floor.code
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600'
                  }`}
                  key={floor.id}
                  onClick={() => setFloorCode(floor.code)}
                  type="button"
                >
                  {floor.code}
                </button>
              ))}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
              {map.name} · {map.version} · {map.active ? 'Active map' : 'Inactive'}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.7fr_0.9fr]">
            <MapCanvas floor={currentFloor} map={map} />

            <div className="space-y-5">
              <section className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <div className="text-sm font-semibold text-slate-950">Robots on {currentFloor.code}</div>
                <div className="mt-1 text-xs text-slate-500">Live robot states for the selected floor.</div>
                <div className="mt-4 space-y-3">
                  {floorRobots.map((robot) => (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 px-4 py-3" key={robot.robotId}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-950">{robot.label}</div>
                        <StatusBadge value={robot.status} />
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {robot.activeTaskCode ? `Active task ${robot.activeTaskCode}` : 'No active task'}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">Battery {robot.batteryLevel}%</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <div className="text-sm font-semibold text-slate-950">Active tasks on {currentFloor.code}</div>
                <div className="mt-1 text-xs text-slate-500">Task destinations currently routed through this floor.</div>
                <div className="mt-4 space-y-3">
                  {floorTasks.map((task) => {
                    const pickup = locationById.get(task.pickupLocationId)
                    const dropoff = locationById.get(task.dropoffLocationId)
                    return (
                      <div className="rounded-3xl border border-slate-200 bg-slate-50/80 px-4 py-3" key={task.id}>
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-slate-950">{task.taskCode}</div>
                          <StatusBadge value={task.status} />
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {(task.assignedRobotLabel ?? 'Queued') + ' · ' + task.progressLabel}
                        </div>
                        <div className="mt-2 text-sm text-slate-700">
                          {pickup?.name ?? 'Pickup'} → {dropoff?.name ?? 'Dropoff'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  )
}
