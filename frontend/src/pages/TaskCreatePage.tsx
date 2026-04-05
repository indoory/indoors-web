import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { startTransition, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { createTask, getCurrentMap } from '../lib/api'

const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

export function TaskCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const mapQuery = useQuery({
    queryKey: ['map', 'current'],
    queryFn: getCurrentMap,
  })

  const [floorCode, setFloorCode] = useState('')
  const [pickupLocationId, setPickupLocationId] = useState<number | null>(null)
  const [dropoffLocationId, setDropoffLocationId] = useState<number | null>(null)
  const [priority, setPriority] = useState('NORMAL')

  const floors = mapQuery.data?.floors ?? []
  const activeFloorCode = floorCode || floors[0]?.code || ''
  const selectedFloor = floors.find((floor) => floor.code === activeFloorCode) ?? floors[0]
  const selectableLocations =
    selectedFloor?.locations.filter((location) => location.type !== 'CORRIDOR') ?? []
  const selectedPickupLocationId = pickupLocationId ?? selectableLocations[0]?.id ?? null
  const selectedDropoffLocationId =
    dropoffLocationId ?? selectableLocations.find((location) => location.id !== selectedPickupLocationId)?.id ?? null

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPickupLocationId || !selectedDropoffLocationId) {
        return
      }

      return createTask({
        pickupLocationId: selectedPickupLocationId,
        dropoffLocationId: selectedDropoffLocationId,
        priority,
      })
    },
    onSuccess: async (task) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['robots'] }),
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        queryClient.invalidateQueries({ queryKey: ['map', 'current'] }),
      ])

      startTransition(() => {
        navigate(`/tasks?created=${task?.taskCode ?? 'TSK'}`)
      })
    },
  })

  return (
    <AppShell
      subtitle="Create a delivery task and let the backend auto-select the best available robot."
      title="New Task"
    >
      <div className="max-w-3xl rounded-[32px] border border-white/70 bg-white/88 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        {mapQuery.isLoading ? <LoadingView compact label="Loading active semantic map..." /> : null}

        <div className="mb-6">
          <div className="text-lg font-semibold text-slate-950">Create delivery task</div>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Indoory will assign a robot automatically using online state, active task load,
            battery threshold, floor match, and heartbeat freshness.
          </p>
        </div>

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            createTaskMutation.mutate()
          }}
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="floor">
              Floor
            </label>
            <select
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white"
              id="floor"
              onChange={(event) => {
                setFloorCode(event.target.value)
                setPickupLocationId(null)
                setDropoffLocationId(null)
              }}
              value={activeFloorCode}
            >
              {floors.map((floor) => (
                <option key={floor.id} value={floor.code}>
                  {floor.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="pickup">
                Pickup location
              </label>
              <select
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white"
                id="pickup"
                onChange={(event) => setPickupLocationId(Number(event.target.value))}
                value={selectedPickupLocationId ?? ''}
              >
                {selectableLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="dropoff">
                Dropoff location
              </label>
              <select
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white"
                id="dropoff"
                onChange={(event) => setDropoffLocationId(Number(event.target.value))}
                value={selectedDropoffLocationId ?? ''}
              >
                {selectableLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-2 block text-sm font-medium text-slate-700">Priority</div>
            <div className="flex flex-wrap gap-3">
              {priorities.map((item) => (
                <label
                  className={`cursor-pointer rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                    priority === item
                      ? 'border-sky-400 bg-sky-50 text-sky-700'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                  key={item}
                >
                  <input
                    checked={priority === item}
                    className="sr-only"
                    name="priority"
                    onChange={() => setPriority(item)}
                    type="radio"
                  />
                  {item}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-sky-100 bg-sky-50 px-5 py-4 text-sm text-sky-900">
            Auto dispatch order: online only, no active task, no fault states, battery above 20%,
            same map and floor first, then highest battery and freshest heartbeat.
          </div>

          <div className="flex gap-3 pt-2">
            <button
              className="h-12 rounded-2xl bg-sky-600 px-6 text-sm font-semibold text-white transition hover:bg-sky-700"
              disabled={createTaskMutation.isPending}
              type="submit"
            >
              {createTaskMutation.isPending ? 'Creating task...' : 'Create task'}
            </button>
            <button
              className="h-12 rounded-2xl border border-slate-200 px-6 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              onClick={() => navigate('/tasks')}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
