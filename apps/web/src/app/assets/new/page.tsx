'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import {
  AdministrativeStatus,
  createManualAsset,
  CreateManualAssetPayload,
  ManualIdentifierType,
} from '@/lib/api';
import { getAssetTypeLabel, getManualIdentifierTypeLabel } from '@/lib/labels';
import { getStatusLabel } from '@/lib/status';

const identifierTypes: ManualIdentifierType[] = [
  'HOSTNAME',
  'SERIAL_NUMBER',
  'ASSET_TAG',
  'MAC_ADDRESS',
  'INTERNAL_NAME',
];
const assetTypes = [
  'SERVER',
  'NOTEBOOK',
  'DESKTOP',
  'WORKSTATION',
  'VM',
  'NETWORK_DEVICE',
  'STORAGE',
  'PRINTER',
  'UNKNOWN',
];
const administrativeStatuses: AdministrativeStatus[] = [
  'IN_USE',
  'IN_STOCK',
  'MAINTENANCE',
  'DEACTIVATED',
  'DISCARDED',
  'LOST',
  'STOLEN',
  'ARCHIVED',
];

type FormState = Record<keyof CreateManualAssetPayload, string>;

const initialForm: FormState = {
  identifier: '',
  identifierType: 'HOSTNAME',
  type: 'NOTEBOOK',
  administrativeStatus: 'IN_STOCK',
  reason: '',
  hostname: '',
  serialNumber: '',
  manufacturer: '',
  model: '',
  operatingSystem: '',
  osVersion: '',
  location: '',
  owner: '',
  department: '',
  environment: '',
  criticality: '',
  comment: '',
};

const optionalFields: Array<keyof CreateManualAssetPayload> = [
  'hostname',
  'serialNumber',
  'manufacturer',
  'model',
  'operatingSystem',
  'osVersion',
  'location',
  'owner',
  'department',
  'environment',
  'criticality',
  'comment',
];

export default function NewAssetPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function update(field: keyof FormState, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!form.identifier.trim() || !form.reason.trim()) {
      setError('Preencha o identificador principal e o motivo do cadastro.');
      return;
    }

    setSubmitting(true);
    const payload: CreateManualAssetPayload = {
      identifier: form.identifier.trim(),
      identifierType: form.identifierType as ManualIdentifierType,
      type: form.type,
      administrativeStatus: form.administrativeStatus as AdministrativeStatus,
      reason: form.reason.trim(),
    };
    optionalFields.forEach((field) => {
      const value = form[field].trim();
      if (value) Object.assign(payload, { [field]: value });
    });

    try {
      const response = await createManualAsset(payload);
      setSuccess(true);
      window.setTimeout(() => router.push(`/assets/${response.asset.id}`), 700);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Não foi possível criar o ativo.',
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell manual-asset-page">
      <Link className="back-link" href="/assets">
        ← Voltar para ativos
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Declaração humana</p>
          <h1>Declarar ativo manualmente</h1>
          <p className="page-description">
            Cadastre um ativo que existe, mas ainda não possui evidência técnica no Atlas.
          </p>
        </div>
      </header>

      <aside className="manual-explanation">
        <strong>O que este cadastro representa?</strong>
        <p>
          Este cadastro cria uma evidência manual. O Atlas não tratará o ativo como tecnicamente
          confirmado até que uma fonte automática o observe.
        </p>
      </aside>

      {error ? (
        <div className="form-message form-message-error" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="form-message form-message-success" role="status">
          Ativo declarado com sucesso. Abrindo o detalhe…
        </div>
      ) : null}

      <form className="manual-asset-form" onSubmit={submit}>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Obrigatório</p>
              <h2>Declaração</h2>
            </div>
          </div>
          <div className="manual-form-grid">
            <label>
              Identificador principal
              <input
                required
                maxLength={255}
                value={form.identifier}
                onChange={(event) => update('identifier', event.target.value)}
                placeholder="Ex.: NB-EST-001"
              />
            </label>
            <label>
              Tipo de identificador
              <select
                value={form.identifierType}
                onChange={(event) => update('identifierType', event.target.value)}
              >
                {identifierTypes.map((type) => (
                  <option key={type} value={type}>
                    {getManualIdentifierTypeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo do ativo
              <select value={form.type} onChange={(event) => update('type', event.target.value)}>
                {assetTypes.map((type) => (
                  <option key={type} value={type}>
                    {getAssetTypeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status administrativo
              <select
                value={form.administrativeStatus}
                onChange={(event) => update('administrativeStatus', event.target.value)}
              >
                {administrativeStatuses.map((status) => (
                  <option key={status} value={status}>
                    {getStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="manual-wide-field">
              Motivo do cadastro
              <textarea
                required
                maxLength={500}
                value={form.reason}
                onChange={(event) => update('reason', event.target.value)}
                placeholder="Explique por que este ativo precisa ser declarado manualmente."
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Opcional</p>
              <h2>Informações do ativo</h2>
            </div>
          </div>
          <div className="manual-form-grid">
            <label>
              Hostname
              <input
                value={form.hostname}
                onChange={(event) => update('hostname', event.target.value)}
              />
            </label>
            <label>
              Número de série
              <input
                value={form.serialNumber}
                onChange={(event) => update('serialNumber', event.target.value)}
              />
            </label>
            <label>
              Fabricante
              <input
                value={form.manufacturer}
                onChange={(event) => update('manufacturer', event.target.value)}
              />
            </label>
            <label>
              Modelo
              <input value={form.model} onChange={(event) => update('model', event.target.value)} />
            </label>
            <label>
              Sistema operacional
              <input
                value={form.operatingSystem}
                onChange={(event) => update('operatingSystem', event.target.value)}
              />
            </label>
            <label>
              Versão do sistema operacional
              <input
                value={form.osVersion}
                onChange={(event) => update('osVersion', event.target.value)}
              />
            </label>
            <label>
              Localidade
              <input
                value={form.location}
                onChange={(event) => update('location', event.target.value)}
              />
            </label>
            <label>
              Responsável
              <input value={form.owner} onChange={(event) => update('owner', event.target.value)} />
            </label>
            <label>
              Área
              <input
                value={form.department}
                onChange={(event) => update('department', event.target.value)}
              />
            </label>
            <label>
              Ambiente
              <input
                value={form.environment}
                onChange={(event) => update('environment', event.target.value)}
              />
            </label>
            <label>
              Criticidade
              <input
                value={form.criticality}
                onChange={(event) => update('criticality', event.target.value)}
              />
            </label>
            <label className="manual-wide-field">
              Comentário
              <textarea
                maxLength={1000}
                value={form.comment}
                onChange={(event) => update('comment', event.target.value)}
              />
            </label>
          </div>
        </section>

        <div className="manual-form-actions">
          <Link className="button button-secondary" href="/assets">
            Cancelar
          </Link>
          <button className="button button-primary" type="submit" disabled={submitting || success}>
            {submitting ? 'Declarando…' : 'Declarar ativo'}
          </button>
        </div>
      </form>
    </main>
  );
}
