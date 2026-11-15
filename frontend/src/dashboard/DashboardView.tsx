import type { Session } from '@iot/contracts';
import { useState } from 'react';
import { Activity, Droplets, LoaderCircle, Power, RefreshCw } from 'lucide-react';
import { Brand, formatDate } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardViewModel } from './useDashboardViewModel';

const cycleLabels = {
  parado: 'Em espera',
  enchendo: 'Enchendo',
  concluido: 'Concluído',
  falha: 'Falha informada',
  desconhecido: 'Sem informação',
};
const commandLabels = {
  pendente: 'Aguardando resposta',
  aceito: 'Aceito pelo IoT',
  rejeitado: 'Rejeitado pelo IoT',
  sem_resposta: 'Sem resposta no prazo',
  falha_envio: 'Envio não confirmado',
};

export function DashboardView({
  session,
  logout,
  expired,
}: {
  session: Session;
  logout: () => Promise<void>;
  expired: () => void;
}) {
  const vm = useDashboardViewModel(expired);
  const { data } = vm;
  const [logoutError, setLogoutError] = useState('');
  const state = data?.state;
  const sensor = state?.sensor.nivel;
  const last = data?.lastCommand;
  const statusTime = state?.generatedAt ?? data?.receivedAt;
  async function exit() {
    try {
      await logout();
    } catch {
      setLogoutError('Não foi possível sair. Tente novamente.');
    }
  }
  return (
    <div className="min-h-svh bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Brand />
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm text-muted-foreground">{session.user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void exit()}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Caixa d’água</h1>
            <p className="text-sm text-muted-foreground">O último estado informado pelo seu dispositivo.</p>
          </div>
          <Badge variant={vm.connection === 'online' ? 'default' : 'secondary'}>
            {vm.connection === 'online'
              ? 'Atualizações conectadas'
              : vm.connection === 'connecting'
                ? 'Conectando atualizações'
                : 'Reconectando atualizações'}
          </Badge>
        </div>
        {(vm.error || logoutError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {vm.error || logoutError}
              <Button variant="outline" size="sm" onClick={vm.refresh}>
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {vm.loading && !data ? (
          <Card>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Buscando o estado do dispositivo…
            </CardContent>
          </Card>
        ) : !data ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              Não foi possível carregar os dados.
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-3" aria-label="Status atual">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Droplets className="size-4" aria-hidden="true" />
                    Sensor de água
                  </CardTitle>
                  <CardDescription>{data.deviceId}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xl font-semibold">
                    {sensor === 'com_agua'
                      ? 'Água no sensor'
                      : sensor === 'sem_agua'
                        ? 'Sem água no sensor'
                        : 'Aguardando leitura'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Leitura no ponto monitorado pelo dispositivo.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Power className="size-4" aria-hidden="true" />
                    Bomba
                  </CardTitle>
                  <CardDescription>Saída informada pelo IoT</CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant={state?.bomba.status === 'ligada' ? 'default' : 'secondary'}>
                    {state?.bomba.status === 'ligada'
                      ? 'Ligada'
                      : state?.bomba.status === 'desligada'
                        ? 'Desligada'
                        : 'Sem informação'}
                  </Badge>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="size-4" aria-hidden="true" />
                    Enchimento
                  </CardTitle>
                  <CardDescription>
                    {state?.enchimento.origem === 'manual'
                      ? 'Solicitação manual'
                      : state?.enchimento.origem === 'automatico'
                        ? 'Ciclo automático'
                        : 'Aguardando dispositivo'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant={state?.enchimento.status === 'falha' ? 'destructive' : 'secondary'}>
                    {state ? cycleLabels[state.enchimento.status] : 'Sem informação'}
                  </Badge>
                </CardContent>
              </Card>
            </section>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                {state?.generatedAt ? 'Gerado em' : 'Recebido em'}: {formatDate(statusTime)}
              </p>
              {data.retained && (
                <p>Leitura recuperada do broker. O recebimento não confirma uma leitura nova.</p>
              )}
            </div>
            <section className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Encher caixa</CardTitle>
                  <CardDescription>
                    O IoT avalia a solicitação e controla o acionamento da bomba.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button disabled={vm.requesting} onClick={() => void vm.fill()}>
                    {vm.requesting ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Droplets aria-hidden="true" />
                    )}
                    {vm.requesting ? 'Enviando solicitação…' : 'Solicitar enchimento'}
                  </Button>
                  {vm.notice && (
                    <Alert role="status">
                      <AlertDescription>{vm.notice}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2 border-t pt-4">
                    <h2 className="text-sm font-medium">Última solicitação</h2>
                    <p className="text-sm">
                      {last ? commandLabels[last.status] : 'Nenhuma solicitação enviada'}
                    </p>
                    {last && (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {last.respondedAt ? 'Resposta recebida em' : 'Solicitado em'}{' '}
                          {formatDate(last.respondedAt ?? last.requestedAt)}
                        </p>
                        {last.response?.status === 'rejeitado' && (
                          <p className="break-words text-sm text-destructive">
                            Motivo: {last.response.motivo}
                            {last.response.mensagem ? ` — ${last.response.mensagem}` : ''}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Comunicação</CardTitle>
                  <CardDescription>A disponibilidade é o último aviso informado pelo IoT.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span>Broker MQTT</span>
                    <Badge variant={data.brokerConnected ? 'default' : 'secondary'}>
                      {data.brokerConnected ? 'Conectado' : 'Desconectado'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Dispositivo</span>
                    <Badge variant="outline">
                      {data.availability?.status === 'online'
                        ? 'Último aviso online'
                        : data.availability?.status === 'offline'
                          ? 'Último aviso offline'
                          : 'Sem aviso recebido'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    Aviso recebido em: {formatDate(data.availability?.receivedAt)}
                  </p>
                  <Button variant="outline" size="sm" onClick={vm.refresh}>
                    <RefreshCw aria-hidden="true" />
                    Atualizar agora
                  </Button>
                </CardContent>
              </Card>
            </section>
            {state?.falha && (
              <Alert variant="destructive">
                <AlertTitle>Falha informada pelo IoT: {state.falha.codigo}</AlertTitle>
                <AlertDescription>{state.falha.mensagem}</AlertDescription>
              </Alert>
            )}
          </>
        )}
        <footer className="text-xs text-muted-foreground">
          Aqua · O painel preserva o último estado recebido.
        </footer>
      </main>
    </div>
  );
}
