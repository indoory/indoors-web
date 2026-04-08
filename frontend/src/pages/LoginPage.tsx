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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600">
            <Bot className="h-7 w-7 text-white" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Indoory</h1>
          <p className="mt-1 text-sm text-slate-500">Indoor robot control platform</p>
        </div>

        {/* Login Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Operator Login</h2>
          <p className="mb-6 text-sm text-slate-500">Sign in to access the fleet control panel.</p>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              setErrorMessage(null)
              loginMutation.mutate()
            }}
          >
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="email">
                Email
              </label>
              <input
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                id="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@indoory.io"
                type="email"
                value={email}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="password">
                Password
              </label>
              <input
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                id="password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password123"
                type="password"
                value={password}
              />
            </div>

            {errorMessage ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMessage}
              </div>
            ) : null}

            <button
              className="mt-2 h-11 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              disabled={loginMutation.isPending}
              type="submit"
            >
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
            Seeded account: <strong>admin@indoory.io</strong> / <strong>password123</strong>
          </div>
        </div>
      </div>
    </div>
  )
}
