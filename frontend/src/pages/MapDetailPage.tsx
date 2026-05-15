import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LoadingView } from '../components/LoadingView'
import { Map3DCanvas } from '../components/Map3DCanvas'
import { StatusBadge } from '../components/StatusBadge'
import {
  ApiError,
  createLocation,
  deleteLocation,
  getMap,
  getMaps,
  updateLocation,
} from '../lib/api'
import { LOCATION_TYPES, type FloorPlan, type LocationReference } from '../types/api'

// 로봇 탭의 콘솔 레이아웃 (RobotsPage.tsx) 을 그대로 미러링.
// 상단 툴바 + (좌: 풀블리드 맵 + 하단 도크 / 우: 사이드 인스펙터) + 하단 상태바.
// localStorage 키도 별개로 두어 사이즈가 로봇 탭과 충돌하지 않게.

type TabId = 'spots' | 'floors' | 'robots' | 'tasks' | 'info'
const TABS: { id: TabId; label: string }[] = [
  { id: 'spots',  label: '스팟' },
  { id: 'floors', label: '층' },
  { id: 'robots', label: '로봇' },
  { id: 'tasks',  label: '태스크' },
  { id: 'info',   label: '정보' },
]

const LS_SIDE = 'mapdetail.sideWidth'
const LS_DOCK = 'mapdetail.dockHeight'

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

type SpotEditor =
  | { mode: 'create'; floorId: number; presetX?: number; presetY?: number }
  | { mode: 'edit'; spot: LocationReference }
  | null

export function MapDetailPage() {
  const { mapId: mapIdParam = '' } = useParams()
  const mapId = Number(mapIdParam)
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<TabId>('spots')
  const [dockOpen, setDockOpen] = useState(true)
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null)
  const [editor, setEditor] = useState<SpotEditor>(null)
  const [armAddSpot, setArmAddSpot] = useState(false)
  const [clickPreview, setClickPreview] = useState<{ x: number; y: number } | null>(null)

  const [sideWidth, setSideWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_SIDE) ?? '', 10)
    return Number.isFinite(v) && v >= 240 && v <= 600 ? v : 320
  })
  const [dockHeight, setDockHeight] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_DOCK) ?? '', 10)
    return Number.isFinite(v) && v >= 80 && v <= 600 ? v : 220
  })
  useEffect(() => { localStorage.setItem(LS_SIDE, String(sideWidth)) }, [sideWidth])
  useEffect(() => { localStorage.setItem(LS_DOCK, String(dockHeight)) }, [dockHeight])

  const detailQuery = useQuery({
    queryKey: ['map', mapId],
    queryFn: () => getMap(mapId),
    enabled: !!mapId,
    refetchInterval: 5_000,
  })
  const mapsQuery = useQuery({ queryKey: ['maps'], queryFn: getMaps, refetchInterval: 10_000 })

  const detail = detailQuery.data
  const floors = detail?.floors ?? []
  const activeFloor = useMemo(() => {
    if (!floors.length) return null
    return floors.find((f) => f.id === selectedFloorId) ?? floors[0]
  }, [floors, selectedFloorId])
  const allSpots = useMemo(() => floors.flatMap((f) => f.locations), [floors])
  const parcelPickupCount = mapsQuery.data?.parcelPickupCount ?? 0
  const parcelPickupOnThisMap = allSpots.find((s) => s.type === 'PARCEL_PICKUP')

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['map', mapId] })
    queryClient.invalidateQueries({ queryKey: ['maps'] })
  }

  const handleMapClick = (worldX: number, worldY: number) => {
    if (!armAddSpot || !activeFloor) return
    // 클릭 좌표를 프리뷰로 표시 → 모달 오픈하면서 X/Y 자동 입력.
    setClickPreview({ x: worldX, y: worldY })
    setEditor({ mode: 'create', floorId: activeFloor.id, presetX: worldX, presetY: worldY })
    setArmAddSpot(false)
  }

  if (!mapId) {
    return (
      <AppShell title="Map" subtitle="">
        <div className="p-6 text-sm text-red-700">Invalid map id.</div>
      </AppShell>
    )
  }

  if (detailQuery.isError) {
    const err = detailQuery.error
    const msg = err instanceof ApiError ? err.message : (err as Error)?.message ?? 'Unknown error'
    return (
      <AppShell title="Map detail" subtitle="">
        <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">맵 상세 정보 로딩 실패</div>
          <div className="mt-1 text-xs">{msg}</div>
          <div className="mt-2 text-xs text-red-600">
            백엔드 서버(:8080)가 떠 있는지 확인하세요.
          </div>
        </div>
      </AppShell>
    )
  }

  if (detailQuery.isLoading || !detail) {
    return (
      <AppShell title="Map detail" subtitle="">
        <LoadingView compact label="Loading map detail…" />
      </AppShell>
    )
  }

  return (
    <AppShell title={detail.name} subtitle="">
      <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col bg-slate-100 text-slate-800">
        {/* Toolbar */}
        <div className="flex h-10 flex-shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 text-sm">
          <Link
            to="/maps"
            className="flex items-center gap-1 rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            맵 목록
          </Link>
          <Sep />
          <ToolBtn
            label={armAddSpot ? '취소' : '스팟 추가'}
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              if (armAddSpot) { setArmAddSpot(false); return }
              if (!activeFloor) return
              setArmAddSpot(true)
            }}
            disabled={!activeFloor}
            accent={armAddSpot ? undefined : 'emerald'}
          />
          {armAddSpot ? (
            <span className="ml-1 text-xs text-emerald-700">
              <Crosshair className="mr-1 inline h-3 w-3" />
              맵을 클릭해 스팟 위치를 지정하세요
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-3 text-slate-500">
            <span className="font-mono text-xs">#{detail.code}</span>
            <span>{floors.length}층 · {allSpots.length}스팟</span>
            <ParcelPickupPill count={parcelPickupCount} />
          </div>
        </div>

        {/* Main row */}
        <div className="flex min-h-0 flex-1">
          {/* 좌측: 맵 + 도크 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1 bg-slate-200">
              {/* Map3DCanvas: 로봇 탭과 동일한 라이브 SLAM 맵 (/ws/map). userSpots prop
                  으로 백엔드 Location (Spot) 을 마커로 함께 그림. PARCEL_PICKUP 은 노란 별. */}
              <Map3DCanvas
                userSpots={(activeFloor?.locations ?? []).map((l) => ({
                  id: l.id,
                  name: l.name,
                  type: l.type,
                  x: Number(l.x),
                  y: Number(l.y),
                }))}
                armed={armAddSpot}
                armedKind={armAddSpot ? 'goto' : null}
                goalPreview={clickPreview}
                onMapClickWorld={handleMapClick}
                eventIdle={!armAddSpot}
              />
              {/* Floor selector overlay (top-left) */}
              {floors.length > 0 ? (
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-slate-800/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur">
                  <span className="text-slate-400">층</span>
                  <select
                    className="bg-transparent text-xs font-semibold text-white outline-none"
                    value={activeFloor?.id ?? ''}
                    onChange={(e) => setSelectedFloorId(Number(e.target.value))}
                  >
                    {floors.map((f) => (
                      <option key={f.id} value={f.id} className="text-slate-900">
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            {dockOpen ? (
              <Splitter axis="y" onResize={(d) => setDockHeight((h) => clamp(h - d, 80, 600))} />
            ) : null}
            <BottomDock
              open={dockOpen}
              height={dockHeight}
              activeTab={activeTab}
              setOpen={setDockOpen}
              setActiveTab={setActiveTab}
            >
              {activeTab === 'spots' ? (
                <SpotsPanel
                  floor={activeFloor}
                  onAdd={() => activeFloor && setEditor({ mode: 'create', floorId: activeFloor.id })}
                  onEdit={(s) => setEditor({ mode: 'edit', spot: s })}
                  onDelete={async (s) => {
                    if (!window.confirm(`스팟 "${s.name}"을(를) 삭제하시겠습니까?`)) return
                    try { await deleteLocation(s.id); invalidateAll() }
                    catch (e) { alert(e instanceof ApiError ? e.message : '삭제 실패') }
                  }}
                />
              ) : null}
              {activeTab === 'floors' ? <FloorsPanel detail={detail} /> : null}
              {activeTab === 'robots' ? <RobotsPanel detail={detail} /> : null}
              {activeTab === 'tasks' ? <TasksPanel detail={detail} allSpots={allSpots} /> : null}
              {activeTab === 'info' ? <InfoPanel detail={detail} totalSpots={allSpots.length} /> : null}
            </BottomDock>
          </div>

          {/* Splitter */}
          <Splitter axis="x" onResize={(d) => setSideWidth((w) => clamp(w - d, 240, 600))} />

          {/* Side aside */}
          <aside
            className="flex flex-shrink-0 flex-col overflow-hidden bg-white"
            style={{ width: sideWidth }}
          >
            <div className="flex-1 overflow-y-auto">
              <Section title="MAP" defaultOpen>
                <KV k="name" v={detail.name} />
                <KV k="code" v={detail.code} />
                <KV k="floors" v={String(floors.length)} />
                <KV k="spots" v={String(allSpots.length)} />
                <KV k="rtabmap-db" v={formatBytes(detail.rtabmapDbSize)} />
                <KV k="nav2 yaml" v={detail.nav2YamlUrl ? '✓' : '—'} />
              </Section>

              <Section title="PICKUP" defaultOpen>
                {parcelPickupCount === 1 && parcelPickupOnThisMap ? (
                  <>
                    <KV k="status" v="✓ set" vClass="text-emerald-600" />
                    <KV k="spot" v={parcelPickupOnThisMap.name} />
                    <KV k="floor" v={String(parcelPickupOnThisMap.floorId)} />
                  </>
                ) : parcelPickupCount === 1 ? (
                  <>
                    <KV k="status" v="✓ (다른 맵)" vClass="text-slate-500" />
                  </>
                ) : parcelPickupCount === 0 ? (
                  <KV k="status" v="⚠ 미설정" vClass="text-amber-600" />
                ) : (
                  <KV k="status" v={`⚠ ${parcelPickupCount}개`} vClass="text-red-600" />
                )}
              </Section>

              <Section title="FLOORS" defaultOpen>
                {floors.length === 0 ? (
                  <div className="text-xs text-slate-400">no floors</div>
                ) : floors.map((f) => (
                  <div key={f.id} className="flex items-center justify-between py-0.5 leading-6">
                    <button
                      type="button"
                      onClick={() => setSelectedFloorId(f.id)}
                      className={`text-left ${activeFloor?.id === f.id ? 'font-semibold text-blue-600' : 'text-slate-700 hover:text-slate-900'}`}
                    >
                      {f.name}
                    </button>
                    <span className="text-slate-400">{f.locations.length} 스팟</span>
                  </div>
                ))}
              </Section>

              <Section title="SPOTS BY TYPE">
                {LOCATION_TYPES.map((t) => {
                  const n = allSpots.filter((s) => s.type === t).length
                  if (n === 0) return null
                  return <KV key={t} k={t} v={String(n)} />
                })}
                {allSpots.length === 0 ? <div className="text-xs text-slate-400">no spots</div> : null}
              </Section>

              <Section title="ROBOTS">
                {detail.robots.length === 0 ? (
                  <div className="text-xs text-slate-400">no robots</div>
                ) : detail.robots.map((r) => (
                  <KV
                    key={r.robotId}
                    k={r.label}
                    v={`${r.status} · ${r.batteryLevel}%`}
                    vClass={(r.batteryLevel ?? 0) < 20 ? 'text-red-600' : ''}
                  />
                ))}
              </Section>
            </div>
          </aside>
        </div>

        {/* Status bar */}
        <div className="flex h-7 flex-shrink-0 items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-500">
          <span>map #{detail.id}</span>
          <span>·</span>
          <span>{floors.length} floors</span>
          <span>·</span>
          <span>{allSpots.length} spots</span>
          <span>·</span>
          <span>{detail.robots.length} robots</span>
          <span>·</span>
          <span>{detail.activeTasks.length} active tasks</span>
          <span className="ml-auto">
            pickup{' '}
            <span className={
              parcelPickupCount === 1 ? 'text-emerald-600'
              : parcelPickupCount === 0 ? 'text-amber-600'
              : 'text-red-600'
            }>
              {parcelPickupCount}/1
            </span>
          </span>
        </div>
      </div>

      {editor ? (
        <SpotModal
          editor={editor}
          parcelPickupExists={parcelPickupCount > 0}
          onClose={() => { setEditor(null); setClickPreview(null) }}
          onSaved={() => { invalidateAll(); setEditor(null); setClickPreview(null) }}
        />
      ) : null}
    </AppShell>
  )
}

// ── Bottom dock panels ────────────────────────────────────────────────────
function SpotsPanel({
  floor,
  onAdd,
  onEdit,
  onDelete,
}: {
  floor: FloorPlan | null
  onAdd: () => void
  onEdit: (s: LocationReference) => void
  onDelete: (s: LocationReference) => void
}) {
  if (!floor) return <div className="text-xs text-slate-400">먼저 층을 선택하세요.</div>
  const spots = floor.locations
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {floor.name} 스팟 ({spots.length})
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-3 w-3" />
          추가
        </button>
      </div>
      {spots.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">이 층에 스팟이 없습니다.</div>
      ) : (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-1.5 pr-2"></th>
              <th className="py-1.5 pr-2">name</th>
              <th className="py-1.5 pr-2">type</th>
              <th className="py-1.5 pr-2">x</th>
              <th className="py-1.5 pr-2">y</th>
              <th className="py-1.5 text-right">action</th>
            </tr>
          </thead>
          <tbody>
            {spots.map((s) => {
              const pickup = s.type === 'PARCEL_PICKUP'
              return (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-1 pr-2 w-4">
                    {pickup ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" /> : <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />}
                  </td>
                  <td className="py-1 pr-2 text-slate-800">{s.name}</td>
                  <td className="py-1 pr-2">
                    <span className={pickup ? 'text-amber-700' : 'text-slate-500'}>{s.type}</span>
                  </td>
                  <td className="py-1 pr-2 text-slate-500">{Number(s.x).toFixed(2)}</td>
                  <td className="py-1 pr-2 text-slate-500">{Number(s.y).toFixed(2)}</td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      onClick={() => onEdit(s)}
                      className="mr-1 rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-200"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s)}
                      className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function FloorsPanel({ detail }: { detail: { floors: FloorPlan[] } }) {
  const fs = detail.floors
  if (fs.length === 0) return <div className="text-xs text-slate-400">층이 없습니다.</div>
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-500">
          <th className="py-1.5 pr-2">code</th>
          <th className="py-1.5 pr-2">name</th>
          <th className="py-1.5 pr-2">order</th>
          <th className="py-1.5 pr-2">spots</th>
          <th className="py-1.5">map image</th>
        </tr>
      </thead>
      <tbody>
        {fs.map((f) => (
          <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="py-1 pr-2 text-slate-700">{f.code}</td>
            <td className="py-1 pr-2 text-slate-800">{f.name}</td>
            <td className="py-1 pr-2 text-slate-500">#{f.orderIndex}</td>
            <td className="py-1 pr-2 text-slate-500">{f.locations.length}</td>
            <td className="py-1 text-slate-500">{f.mapImageUrl ? '✓' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RobotsPanel({ detail }: { detail: { robots: { robotId: number; label: string; status: string; batteryLevel: number; floorCode: string; activeTaskCode: string | null }[] } }) {
  const rs = detail.robots
  if (rs.length === 0) return <div className="text-xs text-slate-400">이 맵에 로봇이 없습니다.</div>
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-500">
          <th className="py-1.5 pr-2">label</th>
          <th className="py-1.5 pr-2">status</th>
          <th className="py-1.5 pr-2">battery</th>
          <th className="py-1.5 pr-2">floor</th>
          <th className="py-1.5">task</th>
        </tr>
      </thead>
      <tbody>
        {rs.map((r) => (
          <tr key={r.robotId} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="py-1 pr-2 text-slate-800">{r.label}</td>
            <td className="py-1 pr-2"><StatusBadge value={r.status} /></td>
            <td className="py-1 pr-2 text-slate-600">{r.batteryLevel}%</td>
            <td className="py-1 pr-2 text-slate-500">{r.floorCode}</td>
            <td className="py-1 text-slate-500">{r.activeTaskCode ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TasksPanel({
  detail,
  allSpots,
}: {
  detail: { activeTasks: { id: number; taskCode: string; status: string; pickupLocationId: number; dropoffLocationId: number; assignedRobotLabel: string | null; progressLabel: string }[] }
  allSpots: LocationReference[]
}) {
  const ts = detail.activeTasks
  const byId = new Map(allSpots.map((s) => [s.id, s]))
  if (ts.length === 0) return <div className="text-xs text-slate-400">활성 태스크가 없습니다.</div>
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-500">
          <th className="py-1.5 pr-2">code</th>
          <th className="py-1.5 pr-2">status</th>
          <th className="py-1.5 pr-2">pickup → dropoff</th>
          <th className="py-1.5 pr-2">robot</th>
          <th className="py-1.5">progress</th>
        </tr>
      </thead>
      <tbody>
        {ts.map((t) => {
          const p = byId.get(t.pickupLocationId)
          const d = byId.get(t.dropoffLocationId)
          return (
            <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="py-1 pr-2 text-blue-600">{t.taskCode}</td>
              <td className="py-1 pr-2"><StatusBadge value={t.status} /></td>
              <td className="py-1 pr-2 text-slate-600">{p?.name ?? '?'} → {d?.name ?? '?'}</td>
              <td className="py-1 pr-2 text-slate-500">{t.assignedRobotLabel ?? 'queued'}</td>
              <td className="py-1 text-slate-500">{t.progressLabel}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function InfoPanel({
  detail,
  totalSpots,
}: {
  detail: {
    id: number
    code: string
    name: string
    nav2YamlUrl?: string | null
    rtabmapDbPath?: string | null
    rtabmapDbSize?: number | null
    rtabmapDbSavedAt?: string | null
    floors: FloorPlan[]
  }
  totalSpots: number
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 font-mono text-xs">
      <KV k="id" v={String(detail.id)} />
      <KV k="code" v={detail.code} />
      <KV k="name" v={detail.name} />
      <KV k="floors" v={String(detail.floors.length)} />
      <KV k="spots" v={String(totalSpots)} />
      <KV k="rtabmap-db" v={formatBytes(detail.rtabmapDbSize)} />
      <KV k="db saved" v={detail.rtabmapDbSavedAt ? new Date(detail.rtabmapDbSavedAt).toLocaleString() : '—'} />
      <KV k="db path" v={detail.rtabmapDbPath ?? '—'} />
      <KV k="nav2 yaml" v={detail.nav2YamlUrl ?? '—'} />
    </div>
  )
}

function ParcelPickupPill({ count }: { count: number }) {
  if (count === 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
        <Star className="h-3 w-3" />
        pickup ✓
      </span>
    )
  }
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        pickup 미설정
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">
      <AlertTriangle className="h-3 w-3" />
      pickup {count}개
    </span>
  )
}

// ── Spot Add/Edit modal ───────────────────────────────────────────────────
function SpotModal({
  editor,
  parcelPickupExists,
  onClose,
  onSaved,
}: {
  editor: Exclude<SpotEditor, null>
  parcelPickupExists: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const initial =
    editor.mode === 'edit'
      ? editor.spot
      : { name: '', type: 'ROOM' as string, x: editor.presetX ?? 0, y: editor.presetY ?? 0 }
  const [name, setName] = useState(initial.name)
  const [type, setType] = useState<string>(initial.type)
  const [x, setX] = useState<string>(String(initial.x))
  const [y, setY] = useState<string>(String(initial.y))
  const [error, setError] = useState<string | null>(null)

  const isCurrentParcelPickup = editor.mode === 'edit' && editor.spot.type === 'PARCEL_PICKUP'
  const wouldViolatePickup =
    type === 'PARCEL_PICKUP' && parcelPickupExists && !isCurrentParcelPickup

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), type, x: Number(x) || 0, y: Number(y) || 0 }
      if (editor.mode === 'create') return createLocation(editor.floorId, payload)
      return updateLocation(editor.spot.id, payload)
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : '저장 실패'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-bold text-slate-900">
          {editor.mode === 'create' ? '스팟 추가' : '스팟 수정'}
        </h3>
        <div className="space-y-3">
          <Field label="이름">
            <input
              autoFocus
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none"
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 1층 로비"
              type="text"
              value={name}
            />
          </Field>
          <Field label="타입">
            <select
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none"
              onChange={(e) => setType(e.target.value)}
              value={type}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="X">
              <input
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none"
                onChange={(e) => setX(e.target.value)}
                step="0.01"
                type="number"
                value={x}
              />
            </Field>
            <Field label="Y">
              <input
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none"
                onChange={(e) => setY(e.target.value)}
                step="0.01"
                type="number"
                value={y}
              />
            </Field>
          </div>
          {wouldViolatePickup ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ 시스템 전체에 PARCEL_PICKUP은 1개만 허용됩니다. 기존 집하 장소를 먼저 삭제하거나 다른 타입으로 바꿔주세요.
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
        </div>
        <div className="mt-6 flex gap-3">
          <button
            className="h-10 flex-1 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
          <button
            className="h-10 flex-1 rounded-lg bg-blue-600 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!name.trim() || wouldViolatePickup || mutation.isPending}
            onClick={() => mutation.mutate()}
            type="button"
          >
            {mutation.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

// ── Console helpers (RobotsPage 와 동일 패턴 — 향후 components/ConsoleShell 로 추출 가능) ──
function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-200" />
}

function ToolBtn({
  onClick, disabled, label, icon, accent,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  icon?: ReactNode
  accent?: 'emerald'
}) {
  const base = accent === 'emerald'
    ? 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400'
    : 'text-slate-700 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded px-2 py-1 ${base}`}
    >
      {icon}{label}
    </button>
  )
}

function BottomDock({
  open, height, activeTab, setOpen, setActiveTab, children,
}: {
  open: boolean
  height: number
  activeTab: TabId
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void
  setActiveTab: (id: TabId) => void
  children: ReactNode
}) {
  return (
    <div
      className="flex flex-shrink-0 flex-col border-t border-slate-200 bg-white"
      style={{ height: open ? height : 32 }}
    >
      <div className="flex h-9 flex-shrink-0 items-stretch border-b border-slate-200 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-10 items-center justify-center text-slate-400 hover:bg-slate-100"
          title={open ? '도크 접기' : '도크 펼치기'}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setActiveTab(t.id); setOpen(true) }}
            className={`min-w-[6rem] border-r border-slate-200 px-6 font-medium transition ${
              activeTab === t.id && open
                ? 'bg-slate-100 font-semibold text-slate-900'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {open ? (
        <div className="flex-1 overflow-auto p-3 text-sm leading-6">
          {children}
        </div>
      ) : null}
    </div>
  )
}

function Splitter({ axis, onResize }: { axis: 'x' | 'y'; onResize: (delta: number) => void }) {
  const dragging = useRef(false)
  const lastPos = useRef(0)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const cur = axis === 'x' ? e.clientX : e.clientY
      const d = cur - lastPos.current
      lastPos.current = cur
      onResize(d)
    }
    const onUp = () => { dragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [axis, onResize])

  if (axis === 'x') {
    return (
      <div
        className="w-1 flex-shrink-0 cursor-col-resize bg-slate-200 hover:bg-blue-400"
        onMouseDown={(e) => { dragging.current = true; lastPos.current = e.clientX; document.body.style.cursor = 'col-resize' }}
      />
    )
  }
  return (
    <div
      className="h-1 flex-shrink-0 cursor-row-resize bg-slate-200 hover:bg-blue-400"
      onMouseDown={(e) => { dragging.current = true; lastPos.current = e.clientY; document.body.style.cursor = 'row-resize' }}
    />
  )
}

function Section({
  title, defaultOpen = false, children,
}: {
  title: string; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open ? <div className="px-3 pb-2 font-mono text-sm">{children}</div> : null}
    </div>
  )
}

function KV({ k, v, vClass }: { k: string; v: ReactNode; vClass?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 leading-6">
      <span className="text-slate-500">{k}</span>
      <span className={`text-slate-800 ${vClass ?? ''}`}>{v}</span>
    </div>
  )
}
