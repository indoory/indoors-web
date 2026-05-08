import { useState } from 'react'
import { setOcrFloor, startSession, startTempMapping } from '../lib/api'

type Props = {
  robotId: number | string | undefined
  onClose: () => void
  onSessionStarted?: () => void
  // robot 의 last-known floor code (예: '4F', 'B3F'). 있으면 default 값으로 미리
  // 채워 사용자가 빠르게 확인. 없으면 빈 칸 — 직접 입력해야 함.
  initialFloorCode?: string | null
}

// 세션 시작 시 (ROS WebSocket 연결 성립 직후) 1회 표시 — 매 boot 마다.
// 시스템은 자동으로 층 가정 X. 운영자가 명시적으로 확인해야 안전 (RTAB-Map .db
// 가 잘못된 층 view 와 매칭되면 잘못된 곳으로 reloc).
// "모르겠음" 누르면 OCR floor 필터 off — OCR 자체는 작동.
export function FloorPromptModal({ robotId, onClose, onSessionStarted, initialFloorCode }: Props) {
  // initialFloorCode 가 '4F' or 'B3F' 형식이면 숫자/지하 분리해 채움.
  const parseInitial = () => {
    if (!initialFloorCode) return { value: '', basement: false }
    const m = initialFloorCode.trim().match(/^(B)?(\d+)F?$/i)
    if (!m) return { value: '', basement: false }
    return { value: m[2], basement: !!m[1] }
  }
  const initial = parseInitial()
  const [value, setValue] = useState(initial.value)
  const [basement, setBasement] = useState(initial.basement)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = (() => {
    const trimmed = value.trim()
    if (!trimmed) return null
    // 음수 입력하면 자동으로 지하 처리
    if (trimmed.startsWith('-')) {
      const n = parseInt(trimmed.slice(1), 10)
      return Number.isFinite(n) && n > 0 ? `B${n}F` : null
    }
    const n = parseInt(trimmed, 10)
    if (!Number.isFinite(n) || n < 1) return null
    return basement ? `B${n}F` : `${n}F`
  })()

  const send = async (code: string) => {
    setSubmitting(true)
    setError(null)
    try {
      if (code && robotId != null) {
        // 정식 세션 시작: Spring 이 IndoorMap 자동 lookup/create + adapter rtabmap
        // reload/fresh + OCR hint set + robot.mapId/floorId 갱신.
        await startSession(robotId, code)
        onSessionStarted?.()
      } else {
        // "모르겠음" 또는 robot 미준비 — OCR hint 만 비우고 맵은 안 건드림.
        await setOcrFloor('')
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '세션 시작 실패')
      setSubmitting(false)
    }
  }

  // 임시 매핑 시작 — 층 모르는 채 일단 매핑. unknown_<ts>.db 로 별도 swap →
  // 기존 ~/.ros/rtabmap.db 손상 0. 사용자가 나중에 "이건 5F 였어" 명시 시 rename.
  const startTemp = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await setOcrFloor('')          // OCR hint 비움 (어느 층인지 모름)
      await startTempMapping()        // 임시 .db 로 mapping 활성
      onSessionStarted?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '임시 매핑 시작 실패')
      setSubmitting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (parsed) send(parsed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <form
        onSubmit={handleSubmit}
        className="relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h3 className="mb-2 text-lg font-bold text-slate-900">현재 층 알려주기</h3>
        <p className="mb-5 text-sm text-slate-500">
          OCR이 방번호 인식 시 해당 층 prefix 로 false-positive 를 거릅니다.
          모르면 건너뛰어도 OCR은 그대로 작동해요.
        </p>

        <label className="block">
          <span className="text-xs font-medium text-slate-600">층 번호</span>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="예: 4, 13, 25"
              disabled={submitting}
              className="h-11 flex-1 rounded-lg border border-slate-300 px-3 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
            />
            <label className="inline-flex select-none items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={basement}
                onChange={(e) => setBasement(e.target.checked)}
                disabled={submitting}
              />
              지하
            </label>
          </div>
          <span className="mt-1 block text-xs text-slate-400">
            {parsed ? `OCR hint: ${parsed}` : '음수 입력 = 지하 (예: -3 → B3F)'}
          </span>
        </label>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => send('')}
            title="모르겠음 — OCR hint 만 비움. RTAB-Map 매핑 안 함 (.db 보호)"
            className="h-11 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            모르겠음
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={startTemp}
            title="층 모르는 채 일단 매핑 — unknown_<ts>.db 별도 파일에 매핑. 기존 .db 손상 0"
            className="h-11 rounded-lg border border-amber-400 bg-amber-50 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
          >
            임시 매핑
          </button>
          <button
            type="submit"
            disabled={submitting || !parsed}
            className="col-span-2 h-11 rounded-lg bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? '...' : '확인'}
          </button>
        </div>

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      </form>
    </div>
  )
}
