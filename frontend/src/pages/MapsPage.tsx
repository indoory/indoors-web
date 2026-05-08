import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Database,
  HardDrive,
  Layers,
  Map as MapIcon,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { MapCanvas } from '../components/MapCanvas'
import { StatusBadge } from '../components/StatusBadge'
import { ApiError, createMap, deleteMap, getMap, getMaps } from '../lib/api'
import type { MapMetadata } from '../types/api'

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function MapsPage() {
  const queryClient = useQueryClient()
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newMapName, setNewMapName] = useState('')
  const [newMapCode, setNewMapCode] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mapsQuery = useQuery({ queryKey: ['maps'], queryFn: getMaps, refetchInterval: 10_000 })
  const maps = mapsQuery.data ?? []

  const detailQuery = useQuery({
    queryKey: ['map', selectedMapId],
    queryFn: () => (selectedMapId ? getMap(selectedMapId) : Promise.reject('No map')),
    enabled: !!selectedMapId,
    refetchInterval: 5_000,
  })

  const createMutation = useMutation({
    mutationFn: () => {
      const code = newMapCode.trim() || newMapName.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
      return createMap({ code, name: newMapName.trim() })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maps'] })
      setIsCreating(false)
      setNewMapName('')
      setNewMapCode('')
      setErrorMessage(null)
    },
    onError: (err) => {
      setErrorMessage(err instanceof ApiError ? err.message : '맵 생성 실패')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (mapId: number) => deleteMap(mapId),
    onSuccess: (_, mapId) => {
      queryClient.invalidateQueries({ queryKey: ['maps'] })
      if (selectedMapId === mapId) setSelectedMapId(null)
      setErrorMessage(null)
    },
    onError: (err) => {
      // Spring 6 ProblemDetail JSON ({"detail":"..."}) — detail 만 뽑아 깔끔히.
      let msg = '맵 삭제 실패'
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message) as { detail?: string }
          if (parsed.detail) msg = parsed.detail
          else msg = err.message
        } catch {
          msg = err.message || msg
        }
      }
      setErrorMessage(msg)
    },
  })

  const handleDelete = (map: MapMetadata) => {
    const ok = window.confirm(`정말로 "${map.name}" 맵을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)
    if (!ok) return
    deleteMutation.mutate(map.id)
  }

  const selectedMap = selectedMapId ? maps.find((m) => m.id === selectedMapId) : null
  const showDetail = !!selectedMapId

  // ── Detail view ─────────────────────────────────────────────────
  if (showDetail) {
    const detail = detailQuery.data
    const floor = detail?.floors[0]
    const robots = detail?.robots ?? []
    const tasks = detail?.activeTasks ?? []
    const locationById = new Map(floor?.locations.map((l) => [l.id, l]) ?? [])

    return (
      <AppShell subtitle="Detailed view of the selected map." title={selectedMap?.name ?? 'Map'}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            onClick={() => setSelectedMapId(null)}
          >
            <ArrowLeft className="h-4 w-4" />
            맵 목록
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            disabled={!selectedMap || deleteMutation.isPending}
            onClick={() => selectedMap && handleDelete(selectedMap)}
            title="맵 삭제"
          >
            <Trash2 className="h-4 w-4" />
            삭제
          </button>
        </div>

        {errorMessage ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        {detailQuery.isLoading || !detail ? (
          <LoadingView compact label="Loading map detail…" />
        ) : (
          <div className="space-y-5">
            {/* Map summary block */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">코드</div>
                  <div className="mt-1 truncate font-mono text-sm text-slate-900">{detail.code}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">RTAB-Map DB</div>
                  <div className="mt-1 text-sm text-slate-900">{formatBytes(detail.rtabmapDbSize)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">DB 저장 시각</div>
                  <div className="mt-1 text-sm text-slate-900">{formatDate(detail.rtabmapDbSavedAt)}</div>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Nav2 YAML URL</div>
                  <div className="mt-1 truncate font-mono text-xs text-slate-700">
                    {detail.nav2YamlUrl ?? '—'}
                  </div>
                </div>
              </div>
            </section>

            {floor ? (
              <div className="grid gap-5 xl:grid-cols-[1.7fr_0.9fr]">
                <MapCanvas floor={floor} map={detail} />

                <div className="space-y-5">
                  <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-sm font-semibold text-slate-900">
                      층 ({detail.floors.length})
                    </div>
                    <div className="mt-3 space-y-2">
                      {detail.floors.map((f) => (
                        <div
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
                          key={f.id}
                        >
                          <div>
                            <div className="text-sm font-medium text-slate-900">{f.name}</div>
                            <div className="text-xs text-slate-500">
                              {f.code} · {f.locations.length} 위치
                            </div>
                          </div>
                          <span className="text-xs text-slate-400">#{f.orderIndex}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-sm font-semibold text-slate-900">로봇 ({robots.length})</div>
                    <div className="mt-3 space-y-2">
                      {robots.length === 0 ? (
                        <div className="text-xs text-slate-400">이 맵에 로봇이 없습니다.</div>
                      ) : null}
                      {robots.map((robot) => (
                        <div
                          className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
                          key={robot.robotId}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-slate-900">{robot.label}</div>
                            <StatusBadge value={robot.status} />
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {robot.activeTaskCode ? `Task ${robot.activeTaskCode}` : 'Idle'} · 배터리 {robot.batteryLevel}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-sm font-semibold text-slate-900">활성 태스크 ({tasks.length})</div>
                    <div className="mt-3 space-y-2">
                      {tasks.length === 0 ? (
                        <div className="text-xs text-slate-400">활성 태스크가 없습니다.</div>
                      ) : null}
                      {tasks.map((task) => {
                        const pickup = locationById.get(task.pickupLocationId)
                        const dropoff = locationById.get(task.dropoffLocationId)
                        return (
                          <div
                            className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
                            key={task.id}
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-slate-900">{task.taskCode}</div>
                              <StatusBadge value={task.status} />
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {(task.assignedRobotLabel ?? 'Queued') + ' · ' + task.progressLabel}
                            </div>
                            <div className="mt-1 text-sm text-slate-700">
                              {pickup?.name ?? 'Pickup'} → {dropoff?.name ?? 'Dropoff'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
                이 맵에는 층이 등록되어 있지 않습니다.
              </div>
            )}
          </div>
        )}
      </AppShell>
    )
  }

  // ── List view (card grid) ───────────────────────────────────────
  return (
    <AppShell subtitle="Browse all maps. Click a card to view details." title="Maps">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          {mapsQuery.isLoading ? '로딩 중…' : `${maps.length}개의 맵`}
        </div>
        {isCreating ? (
          <div className="flex items-center gap-2">
            <input
              className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
              onChange={(e) => setNewMapCode(e.target.value)}
              placeholder="코드 (ex: 1f)"
              type="text"
              value={newMapCode}
            />
            <input
              className="h-9 w-32 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
              onChange={(e) => setNewMapName(e.target.value)}
              placeholder="이름 (ex: 1층)"
              type="text"
              value={newMapName}
            />
            <button
              className="h-9 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              disabled={(!newMapCode && !newMapName) || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              저장
            </button>
            <button
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              onClick={() => {
                setIsCreating(false)
                setNewMapCode('')
                setNewMapName('')
              }}
            >
              취소
            </button>
          </div>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="h-4 w-4" />
            새 맵 추가
          </button>
        )}
      </div>

      {errorMessage ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {mapsQuery.isLoading ? (
        <LoadingView compact label="Loading maps…" />
      ) : maps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          <MapIcon className="mx-auto h-10 w-10 text-slate-300" />
          <div className="mt-3 text-sm font-medium text-slate-700">등록된 맵이 없습니다</div>
          <div className="mt-1 text-xs text-slate-500">
            상단의 "새 맵 추가" 버튼으로 첫 맵을 생성하세요.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((m) => (
            <MapCard
              busy={deleteMutation.isPending && deleteMutation.variables === m.id}
              key={m.id}
              map={m}
              onDelete={() => handleDelete(m)}
              onOpen={() => setSelectedMapId(m.id)}
            />
          ))}
        </div>
      )}
    </AppShell>
  )
}

function MapCard({
  map,
  busy,
  onOpen,
  onDelete,
}: {
  map: MapMetadata
  busy: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const sizeText = useMemo(() => formatBytes(map.rtabmapDbSize), [map.rtabmapDbSize])

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-blue-300 hover:shadow-md">
      <button
        className="flex flex-1 flex-col items-stretch gap-3 px-5 pb-3 pt-5 text-left"
        onClick={onOpen}
        type="button"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <MapIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-slate-900">{map.name}</div>
            <div className="mt-0.5 truncate font-mono text-xs text-slate-500">{map.code}</div>
          </div>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5 text-slate-400" />
            <span>{sizeText}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 text-slate-400" />
            <span className="truncate">{map.nav2YamlUrl ? 'Nav2 ✓' : 'Nav2 —'}</span>
          </div>
          <div className="col-span-2 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-slate-400" />
            <span>저장: {formatDate(map.rtabmapDbSavedAt)}</span>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-2.5">
        <button
          className="text-sm font-medium text-blue-600 transition hover:text-blue-700"
          onClick={onOpen}
          type="button"
        >
          상세보기 →
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="맵 삭제"
          type="button"
        >
          <Trash2 className="h-4 w-4" />
          삭제
        </button>
      </div>
    </div>
  )
}
