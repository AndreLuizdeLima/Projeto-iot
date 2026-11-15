import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@iot/contracts';
import { api, ApiError } from '../api/client';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const expired = useCallback(() => {
    setSession(null);
    setError('Sua sessão expirou. Entre novamente.');
  }, []);
  useEffect(() => {
    let active = true;
    api<Session>('/auth/me')
      .then((value) => {
        if (active) setSession(value);
      })
      .catch((error) => {
        if (active && (!(error instanceof ApiError) || error.status !== 401))
          setError('Não foi possível conectar ao servidor. Tente entrar novamente.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(expired, Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [session, expired]);
  async function login(email: string, password: string) {
    setError('');
    const result = await api<Session>('/auth/login', {
      method: 'POST',
      data: { email, password },
    });
    setSession(result);
  }
  async function logout() {
    await api<void>('/auth/logout', { method: 'POST' });
    setSession(null);
    setError('');
  }
  return { session, loading, error, login, logout, expired };
}
