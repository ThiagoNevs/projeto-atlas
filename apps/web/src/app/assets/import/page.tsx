'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useState } from 'react';

import {
  importAssetsCsv,
  importAssetsSpreadsheet,
  ImportAssetsCsvResponse,
} from '@/lib/api';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const csvExample = `hostname;ipAddress;operatingSystem;osVersion;location;owner;department;type;administrativeStatus;comment
NB-RH-001;10.20.1.15;Windows 11;23H2;Rio de Janeiro;Ana Silva;RH;Notebook;Em uso;Notebook da Ana / máquina do RH`;
const csvTemplateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvExample)}`;

export default function ImportAssetsPage() {
  const [content, setContent] = useState(csvExample);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAssetsCsvResponse | null>(null);

  async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    setError(null);

    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    if (!extension || !['csv', 'xlsx', 'xlsm'].includes(extension)) {
      setSelectedFile(null);
      setError('Formato não aceito. Selecione um arquivo CSV, XLSX ou XLSM.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setSelectedFile(null);
      setError('O arquivo excede o limite de 2 MB.');
      return;
    }
    if (extension === 'csv') {
      setContent(await file.text());
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      setResult(
        selectedFile
          ? await importAssetsSpreadsheet(selectedFile)
          : await importAssetsCsv({ csv: content }),
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Não foi possível importar os ativos.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isXlsm = selectedFile?.name.toLocaleLowerCase().endsWith('.xlsm') ?? false;

  return (
    <main className="page-shell manual-asset-page">
      <Link className="back-link" href="/assets">
        ← Voltar para ativos
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Declaração manual controlada</p>
          <h1>Importar ativos</h1>
          <p className="page-description">
            Formatos aceitos: CSV, XLSX, XLSM e conteúdo colado de planilha.
          </p>
        </div>
      </header>

      <aside className="manual-explanation">
        <strong>Campos obrigatórios: hostname e ipAddress</strong>
        <p>
          O hostname é a identificação principal da importação. O IP é uma informação de rede e
          não uma identidade absoluta. São aceitas até 500 linhas, 30 colunas e arquivos de 2 MB.
          Em XLSX e XLSM, somente a primeira aba é lida.
        </p>
        <p>
          Arquivos XLSM são aceitos somente para leitura dos dados da planilha. Macros nunca são
          executadas pelo Atlas, e fórmulas nunca são avaliadas.
        </p>
      </aside>

      {error ? <div className="form-message form-message-error" role="alert">{error}</div> : null}
      {isXlsm ? (
        <div className="form-message form-message-warning" role="status">
          Arquivo XLSM recebido. Apenas os valores armazenados serão lidos. Macros não são executadas.
        </div>
      ) : null}
      {result ? (
        <section className="form-message form-message-success" role="status">
          <strong>{result.importedCount} ativo(s) importado(s).</strong>
          <p>{result.processedCount} linha(s) processada(s) no formato {result.format}.</p>
          {result.warningCount ? (
            <ul className="csv-warning-list">
              {result.warnings.map((warning) => (
                <li key={`${warning.line}-${warning.field}-${warning.message}`}>
                  Linha {warning.line}: {warning.message}
                </li>
              ))}
            </ul>
          ) : <p>Nenhum aviso gerado.</p>}
        </section>
      ) : null}

      <form className="manual-asset-form" onSubmit={submit}>
        <section className="panel import-entry-grid">
          <div className="import-entry-card">
            <p className="section-kicker">Opção 1</p>
            <h2>Carregar arquivo</h2>
            <p>Selecione um arquivo CSV, XLSX ou XLSM. O arquivo é processado em memória e não é armazenado.</p>
            <label>
              Arquivo
              <input
                accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                type="file"
                onChange={readFile}
              />
            </label>
            {selectedFile ? <span className="selected-import-file">Selecionado: {selectedFile.name}</span> : null}
          </div>

          <div className="import-entry-card">
            <p className="section-kicker">Opção 2</p>
            <h2>Colar dados</h2>
            <p>Cole conteúdo do Excel, Google Sheets ou LibreOffice, usando TAB, ponto e vírgula ou vírgula.</p>
            <label>
              Conteúdo tabular
              <textarea
                required={!selectedFile}
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  setSelectedFile(null);
                  setResult(null);
                }}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Modelo</p>
              <h2>Campos da planilha</h2>
            </div>
            <a className="button button-secondary" download="atlas-modelo-importacao.csv" href={csvTemplateHref}>
              Baixar modelo CSV
            </a>
          </div>
          <div className="csv-header-list">
            <strong>Obrigatórios</strong><code>hostname</code><code>ipAddress</code>
            <strong>Opcionais</strong>
            {['operatingSystem','osVersion','location','owner','department','type','administrativeStatus','manufacturer','model','serialNumber','macAddress','environment','criticality','comment'].map((header) => <code key={header}>{header}</code>)}
          </div>
        </section>

        <div className="manual-form-actions">
          <Link className="button button-secondary" href="/assets">Cancelar</Link>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Importando…' : 'Importar ativos'}
          </button>
        </div>
      </form>
    </main>
  );
}
