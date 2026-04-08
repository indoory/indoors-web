import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { ApiError, createRobot, getFloors, getMaps } from '../lib/api'

export function RobotCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mapsQuery = useQuery({ queryKey: ['maps'], queryFn: getMaps })
  const floorsQuery = useQuery({ queryKey: ['floors'], queryFn: getFloors })

  const [robotCode, setRobotCode] = useState('')
  const [label, setLabel] = useState('')
  const [mapId, setMapId] = useState<string>('')
  const [floorId, setFloorId] = useState<string>('')
  const [poseX, setPoseX] = useState('0.0')
  const [poseY, setPoseY] = useState('0.0')
  const [error, setError] = useState<string | null>(null)

  const maps = mapsQuery.data ?? []
  const floors = floorsQuery.data ?? []

  const mutation = useMutation({
    mutationFn: () =>
      createRobot({
        robotCode,
        label,
        mapId: Number(mapId),
        floorId: Number(floorId),
        poseX: parseFloat(poseX),
        poseY: parseFloat(poseY),
      }),
    onSuccess: (robot) => {
      queryClient.invalidateQueries({ queryKey: ['robots'] })
      navigate(`/robots/${robot.id}`)
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to create robot.')
    },
  })

  return (
    <AppShell subtitle="Register a new robot to the fleet." title="Create Robot">
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">New Robot</h2>
          <p className="mb-6 text-sm text-slate-500">
            Register a robot with its initial map and floor position.
          </p>

          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              mutation.mutate()
            }}
          >
            {/* Robot Code */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="robotCode">
                Robot Code
              </label>
              <input
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                id="robotCode"
                onChange={(e) => setRobotCode(e.target.value)}
                placeholder="e.g. robot-1"
                required
                type="text"
                value={robotCode}
              />
            </div>

            {/* Label */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="label">
                Label
              </label>
              <input
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                id="label"
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. 배달 로봇 1"
                required
                type="text"
                value={label}
              />
            </div>

            {/* Map */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="mapId">
                Map
              </label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                id="mapId"
                onChange={(e) => setMapId(e.target.value)}
                required
                value={mapId}
              >
                <option value="">Select a map...</option>
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Floor */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="floorId">
                Floor
              </label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                id="floorId"
                onChange={(e) => setFloorId(e.target.value)}
                required
                value={floorId}
              >
                <option value="">Select a floor...</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Initial Pose */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="poseX">
                  Initial X
                </label>
                <input
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  id="poseX"
                  onChange={(e) => setPoseX(e.target.value)}
                  placeholder="0.0"
                  step="0.1"
                  type="number"
                  value={poseX}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="poseY">
                  Initial Y
                </label>
                <input
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  id="poseY"
                  onChange={(e) => setPoseY(e.target.value)}
                  placeholder="0.0"
                  step="0.1"
                  type="number"
                  value={poseY}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="flex items-center gap-3 pt-2">
              <button
                className="h-10 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                disabled={mutation.isPending}
                type="submit"
              >
                {mutation.isPending ? 'Creating...' : 'Create Robot'}
              </button>
              <button
                className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                onClick={() => navigate('/robots')}
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
