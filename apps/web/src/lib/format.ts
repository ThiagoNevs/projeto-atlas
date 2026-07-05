const relativeTimeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const BRT_OFFSET_IN_MILLISECONDS = 3 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Não informado';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Data inválida';
  }

  const brtDate = new Date(date.getTime() - BRT_OFFSET_IN_MILLISECONDS);
  return `${pad(brtDate.getUTCDate())}/${pad(brtDate.getUTCMonth() + 1)}/${brtDate.getUTCFullYear()} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())} BRT`;
}

export function formatRelativeTime(value: string | null, now = new Date()): string {
  if (!value) {
    return 'Sem referência temporal';
  }

  const differenceInMinutes = (new Date(value).getTime() - now.getTime()) / 60_000;
  const absoluteMinutes = Math.abs(differenceInMinutes);

  if (absoluteMinutes < 60) {
    return relativeTimeFormatter.format(Math.round(differenceInMinutes), 'minute');
  }

  const differenceInHours = differenceInMinutes / 60;
  if (Math.abs(differenceInHours) < 24) {
    return relativeTimeFormatter.format(Math.round(differenceInHours), 'hour');
  }

  const differenceInDays = differenceInHours / 24;
  return relativeTimeFormatter.format(Math.round(differenceInDays), 'day');
}

export function humanizeStatus(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
