import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, errorMessage } from '../../api/client';
import { Brand } from '../../components/Brand';
import { useAuth } from './AuthProvider';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !password) {
      setError('Introduce un correo válido y tu contraseña.'); return;
    }
    setBusy(true);
    try { await login(email.trim().toLowerCase(), password); }
    catch (error) {
      setError(error instanceof ApiError && (error.status === 401 || error.status === 400)
        ? 'Correo o contraseña incorrectos.' : errorMessage(error));
      setPassword('');
    } finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <Brand />
      <p className="eyebrow">TUS FINANZAS, EN UN SOLO LUGAR</p>
      <h1 id="login-title">Bienvenido de nuevo</h1>
      <p className="muted">Inicia sesión para consultar tus movimientos.</p>
      <form onSubmit={(event) => { void submit(event); }}>
        <label htmlFor="email">Correo electrónico</label>
        <input id="email" type="email" autoComplete="username" required maxLength={254}
          value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" required maxLength={1024}
          value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary full" disabled={busy}>{busy ? 'Iniciando sesión…' : 'Iniciar sesión'}</button>
      </form>
      <p className="login-note">Acceso personal · Gestor Financiero</p>
    </section>
  </main>;
}
