'use client';

import { FormEvent, useState } from 'react';

import { AdministrativeStatus, ConflictStatus, updateConflictStatus } from '@/lib/api';
import { getConflictStatusLabel } from '@/lib/labels';

const editableStatuses: ConflictStatus[] = ['IN_REVIEW', 'RESOLVED', 'IGNORED', 'EXCEPTION'];
const closedAdministrativeStatuses = new Set<AdministrativeStatus>([
  'DEACTIVATED',
  'DISCARDED',
  'LOST',
  'STOLEN',
  'ARCHIVED',
]);

type ConflictStatusFormProps = {
  conflictId: string;
  conflictType: string;
  currentStatus: ConflictStatus;
  administrativeStatus: AdministrativeStatus;
  onChanged: () => Promise<void>;
};

export function ConflictStatusForm({
  conflictId,
  conflictType,
  currentStatus,
  administrativeStatus,
  onChanged,
}: ConflictStatusFormProps) {
  const [status, setStatus] = useState<ConflictStatus | ''>('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const resolutionBlocked =
    conflictType === 'LIFECYCLE_CONFLICT' && closedAdministrativeStatuses.has(administrativeStatus);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!status) {
      setError('Selecione o novo status do conflito.');
      return;
    }

    setSubmitting(true);
    try {
      await updateConflictStatus(conflictId, { status, reason, comment });
      await onChanged();
      setSuccess(`Conflito alterado para ${getConflictStatusLabel(status)}.`);
      setStatus('');
      setReason('');
      setComment('');
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error ? submitError.message : 'Não foi possível tratar o conflito.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="conflict-status-form" onSubmit={handleSubmit}>
      {resolutionBlocked ? (
        <p className="conflict-resolution-guidance">
          Para resolver, reative o ativo ou marque como exceção/ignorado com justificativa.
        </p>
      ) : null}
      <label>
        <span>Novo status</span>
        <select
          required
          value={status}
          onChange={(event) => setStatus(event.target.value as ConflictStatus | '')}
        >
          <option value="">Selecione…</option>
          {editableStatuses.map((option) => (
            <option
              disabled={option === currentStatus || (option === 'RESOLVED' && resolutionBlocked)}
              key={option}
              value={option}
            >
              {getConflictStatusLabel(option)}
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
          placeholder="Motivo da decisão"
        />
      </label>
      <label>
        <span>Comentário</span>
        <textarea
          required
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Contexto da análise"
        />
      </label>
      <div className="form-actions">
        <button className="button button-primary" disabled={submitting} type="submit">
          {submitting ? 'Salvando…' : 'Salvar tratamento'}
        </button>
        <div aria-live="polite">
          {error ? <p className="form-message form-error">{error}</p> : null}
          {success ? <p className="form-message form-success">{success}</p> : null}
        </div>
      </div>
    </form>
  );
}
