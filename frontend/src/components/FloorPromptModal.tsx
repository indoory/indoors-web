import { useState } from 'react'
import { setOcrFloor } from '../lib/api'

type Props = {
  onClose: () => void
}

// 세션 시작 시 (ROS WebSocket 연결 성립 직후) 1회 표시.
// 사용자가 층 번호 직접 입력 → OCR 식 표기로 변환 ('4F' / 'B3F').
// "모르겠음" 누르면 OCR floor 필터 off — OCR 자체는 작동 (false-positive 약간 증가).
export function FloorPromptModal({ onClose }: Props) {
  const [value, setValue] = useState('')
  const [basement, setBasement] = useState(false)
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
      await setOcrFloor(code)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR floor 설정 실패')
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

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => send('')}
            className="h-11 flex-1 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            모르겠음
          </button>
          <button
            type="submit"
            disabled={submitting || !parsed}
            className="h-11 flex-1 rounded-lg bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? '...' : '확인'}
          </button>
        </div>

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      </form>
    </div>
  )
}
