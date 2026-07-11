'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useState } from 'react';

import { importAssetsCsv, ImportAssetsCsvResponse } from '@/lib/api';

const csvExample = `hostname;ipAddress;operatingSystem;osVersion;location;owner;department;type;administrativeStatus;comment
NB-RH-001;10.20.1.15;Windows 11;23H2;Rio de Janeiro;Ana Silva;RH;Notebook;Em uso;Notebook da Ana / máquina do RH
SRV-APP-01;10.30.1.20;Windows Server;2019;Datacenter;Infraestrutura;TI;Servidor;Em uso;Servidor de aplicação principal`;

export default function ImportAssetsCsvPage() {
  const [csv, setCsv] = useState(csvExample);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAssetsCsvResponse | null>(null);

  async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
    setResult(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      setResult(await importAssetsCsv({ csv }));
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Não foi possível importar o CSV.',
      );
    } finally {
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
          <p className="eyebrow">Declaração manual controlada</p>
          <h1>Importar ativos por CSV</h1>
          <p className="page-description">
            Importe ativos em massa usando hostname e endereço IP como dados obrigatórios da
            planilha.
          </p>
        </div>
      </header>

      <aside className="manual-explanation">
        <strong>Regras desta primeira versão</strong>
        <p>
          Cada linha precisa de <code>hostname</code> e <code>ipAddress</code>. O hostname é o
          identificador principal da importação. O IP é registrado como informação de rede e pode
          gerar aviso quando repetido, mas não é tratado como identidade absoluta.
        </p>
      </aside>

      {error ? (
        <div className="form-message form-message-error" role="alert">
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="form-message form-message-success" role="status">
          <strong>{result.importedCount} ativo(s) importado(s).</strong>
          {result.warningCount ? (
            <ul className="csv-warning-list">
              {result.warnings.map((warning) => (
                <li key={`${warning.line}-${warning.field}-${warning.message}`}>
                  Linha {warning.line}: {warning.message}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhum aviso gerado.</p>
          )}
        </section>
      ) : null}

      <form className="manual-asset-form" onSubmit={submit}>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">CSV</p>
              <h2>Planilha de ativos</h2>
            </div>
          </div>
          <div className="csv-import-grid">
            <label>
              Arquivo CSV
              <input accept=".csv,text/csv" type="file" onChange={readFile} />
            </label>
            <label className="manual-wide-field">
              Conteúdo do CSV
              <textarea
                required
                value={csv}
                onChange={(event) => {
                  setCsv(event.target.value);
                  setResult(null);
                }}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Headers aceitos</p>
              <h2>Campos da planilha</h2>
            </div>
          </div>
          <div className="csv-header-list">
            <strong>Obrigatórios</strong>
            <code>hostname</code>
            <code>ipAddress</code>
            <strong>Opcionais</strong>
            <code>operatingSystem</code>
            <code>osVersion</code>
            <code>location</code>
            <code>owner</code>
            <code>department</code>
            <code>type</code>
            <code>administrativeStatus</code>
            <code>manufacturer</code>
            <code>model</code>
            <code>serialNumber</code>
            <code>macAddress</code>
            <code>environment</code>
            <code>criticality</code>
            <code>comment</code>
          </div>
        </section>

        <div className="manual-form-actions">
          <Link className="button button-secondary" href="/assets">
            Cancelar
          </Link>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Importando…' : 'Importar CSV'}
          </button>
        </div>
      </form>
    </main>
  );
}
