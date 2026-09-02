import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '../features/auth/ProtectedRoute'
import { AppShell } from './AppShell'
import { FeedbackProvider } from './Feedback'

const ActivityCenterPage = lazy(() => import('../features/activities/ActivityCenterPage').then((module) => ({ default: module.ActivityCenterPage })))
const CreateActivityPage = lazy(() => import('../features/activities/CreateActivityPage').then((module) => ({ default: module.CreateActivityPage })))
const ActivityWorkspacePage = lazy(() => import('../features/activities/ActivityWorkspacePage').then((module) => ({ default: module.ActivityWorkspacePage })))
const LoginPage = lazy(() => import('../features/auth/LoginPage').then((module) => ({ default: module.LoginPage })))
const RegisterPage = lazy(() => import('../features/auth/RegisterPage').then((module) => ({ default: module.RegisterPage })))
const ClubSettingsPage = lazy(() => import('../features/settings/SettingsPage').then((module) => ({ default: module.ClubSettingsPage })))
const AccountSettingsPage = lazy(() => import('../features/settings/SettingsPage').then((module) => ({ default: module.AccountSettingsPage })))
const SelfCheckinPage = lazy(() => import('../features/checkin/SelfCheckinPage').then((module) => ({ default: module.SelfCheckinPage })))

export function App() {
  return (
    <FeedbackProvider><Suspense fallback={<main className="centered-state">載入頁面…</main>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/checkin/:token" element={<SelfCheckinPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/activities" element={<ActivityCenterPage />} />
            <Route path="/activities/new" element={<CreateActivityPage />} />
            <Route path="/activities/:activityId" element={<ActivityWorkspacePage />} />
            <Route path="/club-settings" element={<ClubSettingsPage />} />
            <Route path="/account-settings" element={<AccountSettingsPage />} />
            <Route path="/settings" element={<Navigate to="/club-settings" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/activities" replace />} />
      </Routes>
    </Suspense></FeedbackProvider>
  )
}
