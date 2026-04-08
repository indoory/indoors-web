import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { MapCanvas } from '../components/MapCanvas'
import { StatusBadge } from '../components/StatusBadge'
import { getMaps, getMap, createMap } from '../lib/api'

export function MapsPage() {
  const queryClient = useQueryClient()
  
  // 1. Fetch available maps (which now represent floors)
  const mapsQuery = useQuery({ queryKey: ['maps'], queryFn: getMaps })
  const maps = mapsQuery.data ?? []

  // 2. Select a map to view. Default to the first active map, or just the first map.
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null)
  
  // Find which mapId to actually show
  const activeMap = maps.find(m => m.active)
  const displayMapId = selectedMapId ?? activeMap?.id ?? maps[0]?.id

  // 3. Fetch the detailed data for the selected map
  const mapDataQuery = useQuery({
    queryKey: ['map', displayMapId],
    queryFn: () => displayMapId ? getMap(displayMapId) : Promise.reject('No Map Selected'),
    enabled: !!displayMapId,
    refetchInterval: 5_000,
  })

  // 4. Create new map state
  const [isCreating, setIsCreating] = useState(false)
  const [newMapName, setNewMapName] = useState('')
  const [newMapCode, setNewMapCode] = useState('')

  const createMutation = useMutation({
    mutationFn: () => createMap({ code: newlyGeneratedCode(newMapCode, newMapName), name: newMapName }),
    onSuccess: (newMap) => {
      queryClient.invalidateQueries({ queryKey: ['maps'] })
      setIsCreating(false)
      setSelectedMapId(newMap.id)
      setNewMapName('')
      setNewMapCode('')
    }
  })

  const newlyGeneratedCode = (code: string, name: string) => {
      if (code) return code;
      return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const mapData = mapDataQuery.data
  const currentFloor = mapData?.floors[0] // Since 1 Map = 1 Floor
  const floorRobots = mapData?.robots ?? []
  const floorTasks = mapData?.activeTasks ?? []
  const locationById = new Map(currentFloor?.locations.map((loc) => [loc.id, loc]) ?? [])

  return (
    <AppShell subtitle="Semantic floor view with robot positions and active task destinations." title="Maps">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {maps.length === 0 && !mapsQuery.isLoading ? (
             <span className="text-sm text-slate-500">No maps available.</span>
          ) : null}
          {maps.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMapId(m.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                displayMapId === m.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {m.name}
            </button>
          ))}
          
          {isCreating ? (
            <div className="flex items-center gap-2 ml-2">
              <input 
                type="text" 
                placeholder="코드 (ex: 1f)" 
                className="h-9 w-24 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                value={newMapCode}
                onChange={e => setNewMapCode(e.target.value)}
              />
              <input 
                type="text" 
                placeholder="이름 (ex: 1층)" 
                className="h-9 w-24 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                value={newMapName}
                onChange={e => setNewMapName(e.target.value)}
              />
              <button 
                className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                onClick={() => createMutation.mutate()}
                disabled={(!newMapCode && !newMapName) || createMutation.isPending}
              >
                저장
              </button>
              <button 
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                onClick={() => setIsCreating(false)}
              >
                취소
              </button>
            </div>
          ) : (
            <button 
              className="ml-2 flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 transition"
              onClick={() => setIsCreating(true)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
              추가
            </button>
          )}
        </div>
        
        {mapData ? (
          <div className="flex items-center gap-3">
             <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-500">
                {mapData.active ? (
                  <span className="flex items-center gap-1.5 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active Map</span>
                ) : 'Inactive Map'}
             </div>
          </div>
        ) : null}
      </div>

      {mapDataQuery.isLoading || mapsQuery.isLoading ? (
        <LoadingView compact label="Loading map data..." />
      ) : !mapData || !currentFloor ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
          No semantic map data available. Please create a map and upload a floor plan.
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.7fr_0.9fr]">
            <MapCanvas floor={currentFloor} map={mapData} />

            <div className="space-y-5">
              <section className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <div className="text-sm font-semibold text-slate-950">Robots on {currentFloor.name}</div>
                <div className="mt-1 text-xs text-slate-500">Live robot states for this map.</div>
                <div className="mt-4 space-y-3">
                  {floorRobots.length === 0 ? <div className="text-xs text-slate-400">No robots found.</div> : null}
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
                <div className="text-sm font-semibold text-slate-950">Active tasks on {currentFloor.name}</div>
                <div className="mt-1 text-xs text-slate-500">Task destinations currently routed through this map.</div>
                <div className="mt-4 space-y-3">
                  {floorTasks.length === 0 ? <div className="text-xs text-slate-400">No active tasks.</div> : null}
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
      )}
    </AppShell>
  )
}
