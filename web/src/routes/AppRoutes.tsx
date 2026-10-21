import { Navigate, Route, Routes } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Loading, RequestError } from '../components/RequestState';
import { useAuth } from '../features/auth/AuthProvider';
import { Login } from '../features/auth/Login';
import { Dashboard } from '../features/dashboard/Dashboard';

export function AppRoutes() {
  const { session, checkSession } = useAuth();
  if (session.status === 'loading') return <main className="session-page"><Brand /><Loading>Comprobando sesión…</Loading></main>;
  if (session.status === 'error') return <main className="session-page"><Brand /><RequestError message={session.message} retry={checkSession} /></main>;
  const authenticated = session.status === 'authenticated';
  return <Routes>
    <Route path="/login" element={authenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
    <Route path="/dashboard" element={authenticated ? <Dashboard key={session.user.id} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to={authenticated ? '/dashboard' : '/login'} replace />} />
  </Routes>;
}
