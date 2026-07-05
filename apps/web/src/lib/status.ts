import type { AdministrativeStatus, OperationalStatus } from './api';

export type StatusCode = OperationalStatus | AdministrativeStatus;
export type StatusTone = 'positive' | 'warning' | 'negative' | 'neutral';

export type StatusMetadata = {
  label: string;
  description: string;
  tone: StatusTone;
};

const statusMetadata: Record<StatusCode, StatusMetadata> = {
  UNKNOWN: {
    label: 'Desconhecido',
    description: 'Estado ainda não determinado pelas evidências disponíveis.',
    tone: 'neutral',
  },
  SEEN_RECENTLY: {
    label: 'Visto recentemente',
    description: 'Ativo observado recentemente por evidência técnica.',
    tone: 'positive',
  },
  OPERATIONAL: {
    label: 'Operacional',
    description: 'Ativo com operação confirmada pelas evidências técnicas.',
    tone: 'positive',
  },
  DEGRADED: {
    label: 'Operação degradada',
    description: 'Evidências indicam que o ativo opera com degradação.',
    tone: 'warning',
  },
  UNAVAILABLE: {
    label: 'Indisponível',
    description: 'Ativo indisponível segundo as evidências técnicas.',
    tone: 'negative',
  },
  IN_USE: {
    label: 'Em uso',
    description: 'Ativo em uso normal.',
    tone: 'positive',
  },
  IN_STOCK: {
    label: 'Em estoque',
    description: 'Ativo guardado, disponível ou aguardando destino.',
    tone: 'neutral',
  },
  PLANNED: {
    label: 'Planejado',
    description: 'Ativo planejado, ainda fora de uso administrativo.',
    tone: 'warning',
  },
  ACTIVE: {
    label: 'Ativo',
    description: 'Cadastro administrativamente ativo.',
    tone: 'positive',
  },
  MAINTENANCE: {
    label: 'Em manutenção',
    description: 'Ativo em manutenção, reparo ou análise.',
    tone: 'warning',
  },
  DEACTIVATED: {
    label: 'Desativado',
    description: 'Ativo retirado de uso, mas ainda pode existir fisicamente.',
    tone: 'negative',
  },
  DISCARDED: {
    label: 'Descartado',
    description: 'Ativo com baixa ou descarte definitivo registrado.',
    tone: 'negative',
  },
  LOST: {
    label: 'Perdido',
    description: 'Ativo não localizado pela empresa.',
    tone: 'negative',
  },
  STOLEN: {
    label: 'Roubado/Furtado',
    description: 'Ativo declarado como roubado ou furtado.',
    tone: 'negative',
  },
  ARCHIVED: {
    label: 'Arquivado',
    description: 'Registro mantido apenas para histórico e auditoria.',
    tone: 'neutral',
  },
  RETIRED: {
    label: 'Retirado',
    description: 'Ativo retirado administrativamente de uso.',
    tone: 'negative',
  },
};

export function getStatusMetadata(status: StatusCode): StatusMetadata {
  return statusMetadata[status];
}

export function getStatusLabel(status: string): string {
  return statusMetadata[status as StatusCode]?.label ?? status;
}
