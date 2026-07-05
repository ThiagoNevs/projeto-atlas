import type { AdministrativeStatus, AssetConflict } from '@/lib/api';
import Link from 'next/link';
import { getConflictStatusLabel, getConflictTypeLabel, getImpactLabel } from '@/lib/labels';
import { getStatusLabel } from '@/lib/status';

type LifecycleConflictAlertProps = {
  administrativeStatus: AdministrativeStatus;
  conflict: AssetConflict;
};

export function LifecycleConflictAlert({
  administrativeStatus,
  conflict,
}: LifecycleConflictAlertProps) {
  return (
    <section className="lifecycle-alert" role="alert">
      <div className="lifecycle-alert-icon" aria-hidden="true">
        !
      </div>
      <div className="lifecycle-alert-content">
        <div className="lifecycle-alert-heading">
          <div>
            <p className="section-kicker">
              {getConflictTypeLabel(conflict.conflictType)} · {getImpactLabel(conflict.impact)} ·{' '}
              {getConflictStatusLabel(conflict.status)}
            </p>
            <h2>Ativo encerrado voltou a aparecer</h2>
          </div>
        </div>
        <p>
          Este ativo possui status administrativo{' '}
          <strong>{getStatusLabel(administrativeStatus)}</strong>, mas recebeu nova evidência
          técnica.
        </p>
        <ul className="lifecycle-actions" aria-label="Próximas ações sugeridas">
          <li>Investigar</li>
          <li>
            <Link href={`/conflicts#conflict-${conflict.id}`}>Abrir no Resolution Center</Link>
          </li>
          <li>
            <a href="#administrative-status">Reativar manualmente pelo formulário de status</a>
          </li>
          <li>Manter como exceção futuramente</li>
        </ul>
      </div>
    </section>
  );
}
