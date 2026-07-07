'use client';

import { FormEvent, useState } from 'react';

import {
  ApiError,
  enrichAssetManually,
  ManualEnrichmentAttributes,
  ManualEnrichmentPayload,
} from '@/lib/api';

type AttributeKey = Exclude<keyof ManualEnrichmentAttributes, 'comment'>;

const fields: Array<{ key: AttributeKey; label: string }> = [
  { key: 'operatingSystem', label: 'Sistema operacional' },
  { key: 'osVersion', label: 'Versão do sistema operacional' },
  { key: 'manufacturer', label: 'Fabricante' },
  { key: 'model', label: 'Modelo' },
  { key: 'serialNumber', label: 'Número de série' },
  { key: 'location', label: 'Localidade' },
  { key: 'owner', label: 'Responsável' },
  { key: 'department', label: 'Área' },
  { key: 'environment', label: 'Ambiente' },
  { key: 'criticality', label: 'Criticidade' },
];

const emptyAttributes: Record<AttributeKey, string> = {
  operatingSystem: '',
  osVersion: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  location: '',
  owner: '',
  department: '',
  environment: '',
  criticality: '',
};

function normalizeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function ManualEnrichmentForm({
  assetId,
  existingAttributeKeys,
  onChanged,
}: {
  assetId: string;
  existingAttributeKeys: string[];
  onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [attributes, setAttributes] = useState(emptyAttributes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const existing = new Set(existingAttributeKeys.map(normalizeKey));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const provided = Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value.trim()),
    ) as ManualEnrichmentAttributes;
    if (!reason.trim()) {
      setError('Informe o motivo do enriquecimento.');
      return;
    }
    if (!Object.keys(provided).length) {
      setError('Preencha pelo menos uma informação ausente.');
      return;
    }

    setSubmitting(true);
    const payload: ManualEnrichmentPayload = {
      reason: reason.trim(),
      comment: comment.trim() || undefined,
      attributes: provided,
    };
    try {
      const result = await enrichAssetManually(assetId, payload);
      setSuccess(
        `${result.createdAttributes.length} informação(ões) adicionada(s) com evidência manual.`,
      );
      setReason('');
      setComment('');
      setAttributes(emptyAttributes);
      await onChanged();
    } catch (submitError) {
      setError(
        submitError instanceof ApiError && submitError.status === 409
          ? 'Este campo já possui um valor atual diferente. Para evitar sobrescrever evidências, a alteração não foi aplicada.'
          : submitError instanceof Error
            ? submitError.message
            : 'Não foi possível adicionar a informação manual.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel full-panel manual-enrichment-section">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Complemento auditável</p>
          <h2>Adicionar informação manual</h2>
        </div>
      </div>
      <p className="muted-copy">
        Esta ação cria uma evidência manual. Ela não altera a origem técnica do ativo e não
        sobrescreve evidências existentes.
      </p>
      {error ? (
        <div className="form-message form-message-error" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="form-message form-message-success" role="status">
          {success}
        </div>
      ) : null}
      <form className="manual-enrichment-form" onSubmit={submit}>
        <div className="manual-form-grid">
          {fields.map((field) => {
            const filled = existing.has(normalizeKey(field.key));
            return (
              <label key={field.key}>
                {field.label}
                <input
                  disabled={filled}
                  value={attributes[field.key]}
                  onChange={(event) =>
                    setAttributes((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  placeholder={filled ? 'Já possui valor atual' : undefined}
                />
              </label>
            );
          })}
          <label className="manual-wide-field">
            Motivo
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="manual-wide-field">
            Comentário
            <textarea
              maxLength={1000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
        </div>
        <div className="manual-form-actions">
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Salvando…' : 'Salvar informação manual'}
          </button>
        </div>
      </form>
    </section>
  );
}
