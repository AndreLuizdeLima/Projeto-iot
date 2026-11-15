import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandView, Dashboard, Session } from '@iot/contracts';
import { api, ApiError } from '../api/client';

export function useDashboardViewModel(expired: () => void) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const refreshRef = useRef<() => void>(() => {});
  const retryKey = useRef<string | null>(null);
  const handleError = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) expired();
      else setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar os dados.');
    },
    [expired],
  );

  useEffect(() => {
    let active = true;
    let running = false;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function refresh() {
      if (!active) return;
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      do {
        dirty = false;
        try {
          const result = await api<Dashboard>('/dispositivo', { signal: controller.signal });
          if (active) {
            setData(result);
            setError('');
          }
        } catch (cause) {
          if (active) handleError(cause);
        } finally {
          if (active) setLoading(false);
        }
      } while (dirty && active);
      running = false;
    }
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    }
    refreshRef.current = schedule;
    const events = new EventSource('/api/eventos');
    events.onopen = () => {
      if (active) {
        setConnection('online');
        schedule();
      }
    };
    events.addEventListener('dispositivo.atualizado', schedule);
    events.onerror = () => {
      if (!active) return;
      setConnection('offline');
      void api<Session>('/auth/me').catch((cause) => {
        if (active && cause instanceof ApiError && cause.status === 401) expired();
      });
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      events.close();
      refreshRef.current = () => {};
    };
  }, [expired, handleError]);

  async function fill() {
    if (!data || requesting) return;
    setRequesting(true);
    setNotice('');
    setError('');
    // Reutiliza a chave se a rede falhar: uma repetição não gera outro acionamento.
    retryKey.current ??= crypto.randomUUID();
    try {
      const command = await api<CommandView>(`/dispositivos/${encodeURIComponent(data.deviceId)}/encher`, {
        method: 'POST',
        headers: { 'Idempotency-Key': retryKey.current },
        data: {},
      });
      retryKey.current = null;
      setNotice(
        command.status === 'falha_envio'
          ? 'O envio não foi confirmado. O último estado foi preservado.'
          : 'Solicitação registrada. Acompanhe a resposta do dispositivo abaixo.',
      );
      refreshRef.current();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) retryKey.current = null;
      handleError(cause);
    } finally {
      setRequesting(false);
    }
  }
  return { data, loading, requesting, error, notice, connection, fill, refresh: () => refreshRef.current() };
}
