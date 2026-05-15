import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Database,
  HardDrive,
  Layers,
  Map as MapIcon,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { ApiError, createMap, deleteMap, getMaps } from '../lib/api'
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [newMapName, setNewMapName] = useState('')
  const [newMapCode, setNewMapCode] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mapsQuery = useQuery({ queryKey: ['maps'], queryFn: getMaps, refetchInterval: 10_000 })
  const maps = mapsQuery.data?.maps ?? []
  const parcelPickupCount = mapsQuery.data?.parcelPickupCount ?? 0

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maps'] })
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

      <ParcelPickupBanner count={parcelPickupCount} />

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
              onOpen={() => navigate(`/maps/${m.id}`)}
            />
          ))}
        </div>
      )}
    </AppShell>
  )
}

function ParcelPickupBanner({ count }: { count: number }) {
  if (count === 1) return null
  if (count === 0) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4" />
        <span>
          <strong>택배 집하 장소가 설정되지 않았습니다.</strong> 맵을 열어 PARCEL_PICKUP 타입의 스팟을 1개 추가하세요.
        </span>
      </div>
    )
  }
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertTriangle className="h-4 w-4" />
      <span>
        <strong>택배 집하 장소가 {count}개 존재합니다.</strong> 시스템 전체에서 1개여야 합니다 — 중복된 PARCEL_PICKUP 스팟을 제거하세요.
      </span>
    </div>
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
