'use client';

import { FormEvent, useState } from 'react';

import { AdministrativeStatus, updateAdministrativeStatus } from '@/lib/api';
import { getStatusLabel } from '@/lib/status';

const editableStatuses: AdministrativeStatus[] = [
  'IN_USE',
  'IN_STOCK',
  'MAINTENANCE',
  'DEACTIVATED',
  'DISCARDED',
  'LOST',
  'STOLEN',
  'ARCHIVED',
];

type AdministrativeStatusFormProps = {
  assetId: string;
  currentStatus: AdministrativeStatus;
  onChanged: () => Promise<void>;
};

export function AdministrativeStatusForm({
  assetId,
  currentStatus,
  onChanged,
}: AdministrativeStatusFormProps) {
  const [administrativeStatus, setAdministrativeStatus] = useState<AdministrativeStatus | ''>('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!administrativeStatus) {
      setError('Selecione um novo status administrativo.');
      return;
    }

    setSubmitting(true);
    try {
      await updateAdministrativeStatus(assetId, { administrativeStatus, reason, comment });
      await onChanged();
      setSuccess(`Status administrativo alterado para ${getStatusLabel(administrativeStatus)}.`);
      setAdministrativeStatus('');
      setReason('');
      setComment('');
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error ? submitError.message : 'Não foi possível alterar o status.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel full-panel administrative-status-panel" id="administrative-status">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Ação administrativa auditável</p>
          <h2>Alterar status administrativo</h2>
        </div>
        <span className="current-status-copy">Atual: {getStatusLabel(currentStatus)}</span>
      </div>

      <form className="administrative-status-form" onSubmit={handleSubmit}>
        <label>
          <span>Novo status</span>
          <select
            required
            value={administrativeStatus}
            onChange={(event) =>
              setAdministrativeStatus(event.target.value as AdministrativeStatus | '')
            }
          >
            <option value="">Selecione…</option>
            {editableStatuses.map((status) => (
              <option disabled={status === currentStatus} key={status} value={status}>
                {getStatusLabel(status)}
                {status === currentStatus ? ' (atual)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Motivo</span>
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: Baixa patrimonial"
          />
        </label>

        <label className="comment-field">
          <span>Comentário</span>
          <textarea
            required
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Contexto e evidências da decisão administrativa"
          />
        </label>

        <div className="form-actions">
          <button className="button button-primary" disabled={submitting} type="submit">
            {submitting ? 'Salvando…' : 'Salvar alteração'}
          </button>
          <div aria-live="polite">
            {error ? <p className="form-message form-error">{error}</p> : null}
            {success ? <p className="form-message form-success">{success}</p> : null}
          </div>
        </div>
      </form>
    </section>
  );
}
