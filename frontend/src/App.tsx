import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { LoadingView } from './components/LoadingView'
import { useSession } from './hooks/useSession'
import { DashboardPage } from './pages/DashboardPage'
import { EventsPage } from './pages/EventsPage'
import { LoginPage } from './pages/LoginPage'
import { MapsPage } from './pages/MapsPage'
import { RobotDetailPage } from './pages/RobotDetailPage'
import { RobotCreatePage } from './pages/RobotCreatePage'
import { RobotsPage } from './pages/RobotsPage'
import { TaskCreatePage } from './pages/TaskCreatePage'
import { TasksPage } from './pages/TasksPage'

function ProtectedRoute() {
  const session = useSession()
  const location = useLocation()

  if (session.isLoading) {
    return <LoadingView label="Connecting to Indoory control plane..." />
  }

  if (session.isError || !session.data) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />
  }

  return <Outlet />
}

function GuestRoute() {
  const session = useSession()

  if (session.isLoading) {
    return <LoadingView label="Checking operator session..." />
  }

  if (session.data) {
    return <Navigate replace to="/dashboard" />
  }

  return <Outlet />
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-6">
      <div className="max-w-md rounded-[32px] border border-white/60 bg-white/90 p-10 text-center shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="text-sm font-semibold uppercase tracking-[0.32em] text-sky-700">404</div>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">Page not found</h1>
        <p className="mt-3 text-sm text-slate-500">
          The Indoory control page you requested does not exist.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route element={<LoginPage />} path="/login" />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<Navigate replace to="/dashboard" />} path="/" />
        <Route element={<DashboardPage />} path="/dashboard" />
        <Route element={<RobotsPage />} path="/robots" />
        <Route element={<RobotCreatePage />} path="/robots/new" />
        <Route element={<RobotDetailPage />} path="/robots/:robotId" />
        <Route element={<TasksPage />} path="/tasks" />
        <Route element={<TaskCreatePage />} path="/tasks/new" />
        <Route element={<MapsPage />} path="/maps" />
        <Route element={<EventsPage />} path="/events" />
      </Route>

      <Route element={<NotFound />} path="*" />
    </Routes>
  )
}
