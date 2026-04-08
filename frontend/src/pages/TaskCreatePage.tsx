import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { startTransition, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { createTask, getCurrentMap } from '../lib/api'

const priorities = [
  { value: 'LOW', label: 'Low', color: 'text-slate-600' },
  { value: 'NORMAL', label: 'Normal', color: 'text-slate-700' },
  { value: 'HIGH', label: 'High', color: 'text-amber-700' },
  { value: 'URGENT', label: 'Urgent', color: 'text-red-600' },
]

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
    dropoffLocationId ??
    selectableLocations.find((location) => location.id !== selectedPickupLocationId)?.id ??
    null

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPickupLocationId || !selectedDropoffLocationId) return
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
      subtitle="New delivery task"
      title="Create Task"
    >
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2">
        <Link className="flex items-center gap-1 text-sm text-slate-500 transition hover:text-blue-600" to="/tasks">
          <ChevronLeft className="h-4 w-4" />
          Tasks
        </Link>
        <svg className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span className="text-sm font-medium text-slate-900">New Task</span>
      </div>

      <div className="max-w-2xl">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-6 text-lg font-semibold text-slate-900">Create New Task</h2>

          {mapQuery.isLoading ? <LoadingView compact label="Loading active map..." /> : null}

          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              createTaskMutation.mutate()
            }}
          >
            {/* Floor */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="floor">
                Floor
              </label>
              <select
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                id="floor"
                onChange={(e) => {
                  setFloorCode(e.target.value)
                  setPickupLocationId(null)
                  setDropoffLocationId(null)
                }}
                value={activeFloorCode}
              >
                {floors.map((floor) => (
                  <option key={floor.id} value={floor.code}>{floor.name}</option>
                ))}
              </select>
            </div>

            {/* Pickup / Dropoff */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="pickup">
                  Pickup Location
                </label>
                <select
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  id="pickup"
                  onChange={(e) => setPickupLocationId(Number(e.target.value))}
                  value={selectedPickupLocationId ?? ''}
                >
                  {selectableLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="dropoff">
                  Dropoff Location
                </label>
                <select
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  id="dropoff"
                  onChange={(e) => setDropoffLocationId(Number(e.target.value))}
                  value={selectedDropoffLocationId ?? ''}
                >
                  {selectableLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Priority</label>
              <div className="flex gap-3">
                {priorities.map((p) => (
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 transition ${
                      priority === p.value
                        ? 'border-2 border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                    key={p.value}
                  >
                    <input
                      checked={priority === p.value}
                      className="h-4 w-4 text-blue-600"
                      name="priority"
                      onChange={() => setPriority(p.value)}
                      type="radio"
                      value={p.value}
                    />
                    <span className={`text-sm ${priority === p.value ? 'font-medium text-slate-700' : p.color}`}>
                      {p.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Auto-dispatch info */}
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              Auto-dispatch order: online only, no active task, no fault, battery above 20%, same floor first, then highest battery.
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
              <button
                className="h-11 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                disabled={createTaskMutation.isPending}
                type="submit"
              >
                {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
              </button>
              <button
                className="h-11 rounded-lg border border-slate-300 px-6 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => navigate('/tasks')}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  )
}
