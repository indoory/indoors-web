import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, login } from '../lib/api'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('admin@indoory.io')
  const [password, setPassword] = useState('password123')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loginMutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      const from = (location.state as { from?: string } | undefined)?.from ?? '/dashboard'
      navigate(from, { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
        return
      }

      setErrorMessage('Unable to sign in right now.')
    },
  })

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-18 w-18 items-center justify-center rounded-[28px] bg-sky-500 text-white shadow-[0_22px_50px_rgba(14,165,233,0.35)]">
            <Bot className="h-8 w-8" />
          </div>
          <div className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">Indoory</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Indoor robot control</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Sign in to monitor fleet state, issue robot commands, and manage indoor delivery tasks.
          </p>
        </div>

        <div className="rounded-[32px] border border-white/70 bg-white/88 p-8 shadow-[0_35px_90px_rgba(15,23,42,0.14)] backdrop-blur">
          <div className="mb-6">
            <div className="text-sm font-semibold text-slate-950">Operator login</div>
            <div className="mt-1 text-sm text-slate-500">
              Use the seeded admin account to enter the MVP control plane.
            </div>
          </div>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setErrorMessage(null)
              loginMutation.mutate()
            }}
          >
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="email">
                Email
              </label>
              <input
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@indoory.io"
                type="email"
                value={email}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="password">
                Password
              </label>
              <input
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="password123"
                type="password"
                value={password}
              />
            </div>

            {errorMessage ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMessage}
              </div>
            ) : null}

            <button
              className="mt-2 h-12 w-full rounded-2xl bg-sky-600 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(14,165,233,0.28)] transition hover:bg-sky-700"
              disabled={loginMutation.isPending}
              type="submit"
            >
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">
            Seeded account: <strong>admin@indoory.io</strong> / <strong>password123</strong>
          </div>
        </div>
      </div>
    </div>
  )
}
