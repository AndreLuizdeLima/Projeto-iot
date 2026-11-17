import { Droplets } from 'lucide-react';

export function Brand() {
  return (
    <div className="flex items-center gap-2 font-semibold text-primary">
      <Droplets className="size-5" aria-hidden="true" />
      <span>Cisterna segura</span>
    </div>
  );
}

export function formatDate(value?: string | null) {
  if (!value) return 'Ainda não recebido';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(
    new Date(value),
  );
}
