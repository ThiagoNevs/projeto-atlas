'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useState } from 'react';

import {
  commitAssetsCsv,
  commitAssetsSpreadsheet,
  ImportAssetsCsvResponse,
  ImportAssetsPreviewResponse,
  ImportPreviewRow,
  previewAssetsCsv,
  previewAssetsSpreadsheet,
} from '@/lib/api';
import { downloadCsvFile } from '@/lib/file-download';
import {
  attemptImportReportDownload,
  buildImportAnalysisCsv,
  buildImportFinalCsv,
  buildImportReportFilename,
  importReportAvailability,
} from '@/lib/import-report';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const csvExample = `hostname;ipAddress;operatingSystem;osVersion;location;owner;department;type;administrativeStatus;comment
NB-RH-001;10.20.1.15;Windows 11;23H2;Rio de Janeiro;Ana Silva;RH;Notebook;Em uso;Notebook da Ana / máquina do RH`;
const csvTemplateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvExample)}`;

const statusPresentation: Record<ImportPreviewRow['status'], { label: string; className: string }> = {
  VALID: { label: 'Pronto para importar', className: 'status-positive' },
  VALID_WITH_WARNINGS: { label: 'Importável com aviso', className: 'status-warning' },
  DUPLICATE: { label: 'Duplicado', className: 'status-neutral' },
  INVALID: { label: 'Linha inválida', className: 'status-negative' },
};

export default function ImportAssetsPage() {
  const [content, setContent] = useState(csvExample);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportAssetsPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportAssetsCsvResponse | null>(null);
  const [committedPreview, setCommittedPreview] = useState<ImportAssetsPreviewResponse | null>(null);

  function resetAnalysis(): void {
    setPreview(null);
    setResult(null);
    setCommittedPreview(null);
    setError(null);
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    resetAnalysis();

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

  async function analyze(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setCommittedPreview(null);

    try {
      setPreview(
        selectedFile
          ? await previewAssetsSpreadsheet(selectedFile)
          : await previewAssetsCsv({ csv: content }),
      );
    } catch (analysisError) {
      setPreview(null);
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : 'Não foi possível analisar os dados informados.',
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function commit(): Promise<void> {
    if (!preview?.summary.valid) return;
    const analyzedPreview = preview;
    setCommitting(true);
    setError(null);

    try {
      const response = selectedFile
        ? await commitAssetsSpreadsheet(selectedFile)
        : await commitAssetsCsv({ csv: content });
      setResult(response);
      setCommittedPreview(analyzedPreview);
      setPreview(null);
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : 'Não foi possível concluir a importação.',
      );
    } finally {
      setCommitting(false);
    }
  }

  function downloadAnalysisReport(): void {
    if (!preview) return;
    setError(
      attemptImportReportDownload(() =>
        downloadCsvFile(buildImportAnalysisCsv(preview), buildImportReportFilename('analysis')),
      ),
    );
  }

  function downloadFinalReport(): void {
    if (!result || !committedPreview) return;
    setError(
      attemptImportReportDownload(() =>
        downloadCsvFile(
          buildImportFinalCsv(committedPreview, result),
          buildImportReportFilename('final'),
        ),
      ),
    );
  }

  const isXlsm = selectedFile?.name.toLocaleLowerCase().endsWith('.xlsm') ?? false;
  const reportAvailability = importReportAvailability(preview, result);

  return (
    <main className="page-shell manual-asset-page">
      <Link className="back-link" href="/assets">← Voltar para ativos</Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Declaração manual controlada</p>
          <h1>Importar ativos</h1>
          <p className="page-description">
            Analise cada linha antes de importar arquivos CSV, XLSX, XLSM ou conteúdo colado.
          </p>
        </div>
      </header>

      <aside className="manual-explanation">
        <strong>Campos obrigatórios: hostname e ipAddress</strong>
        <p>
          O hostname é a identificação principal. Hostnames já cadastrados serão ignorados sem
          bloquear as outras linhas. IP repetido gera aviso, pois não é uma identidade absoluta.
        </p>
        <p>
          São aceitas até 500 linhas, 30 colunas e arquivos de 2 MB. Em XLSX e XLSM, somente a
          primeira aba é lida; macros e fórmulas nunca são executadas.
        </p>
      </aside>

      {error ? <div className="form-message form-message-error" role="alert">{error}</div> : null}
      {isXlsm ? (
        <div className="form-message form-message-warning" role="status">
          Arquivo XLSM recebido. Apenas valores armazenados serão lidos; macros não são executadas.
        </div>
      ) : null}

      {result && committedPreview ? (
        <ImportResult
          canDownloadReport={reportAvailability.final}
          result={result}
          onDownloadReport={downloadFinalReport}
        />
      ) : null}

      <form className="manual-asset-form" onSubmit={analyze}>
        <section className="panel import-entry-grid">
          <div className="import-entry-card">
            <p className="section-kicker">Opção 1</p>
            <h2>Carregar arquivo</h2>
            <p>O arquivo é processado somente em memória e não é armazenado.</p>
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
            <p>Cole dados usando TAB, ponto e vírgula ou vírgula.</p>
            <label>
              Conteúdo tabular
              <textarea
                required={!selectedFile}
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  setSelectedFile(null);
                  resetAnalysis();
                }}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Modelo</p><h2>Campos da planilha</h2></div>
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
          <button className="button button-primary" type="submit" disabled={analyzing || committing}>
            {analyzing ? 'Analisando…' : 'Analisar arquivo'}
          </button>
        </div>
      </form>

      {preview ? (
        <ImportPreview
          canDownloadReport={reportAvailability.analysis}
          preview={preview}
          committing={committing}
          onCommit={commit}
          onDownloadReport={downloadAnalysisReport}
        />
      ) : null}
    </main>
  );
}

function ImportPreview({
  canDownloadReport,
  preview,
  committing,
  onCommit,
  onDownloadReport,
}: {
  canDownloadReport: boolean;
  preview: ImportAssetsPreviewResponse;
  committing: boolean;
  onCommit: () => Promise<void>;
  onDownloadReport: () => void;
}) {
  const cards = [
    ['Total de linhas', preview.summary.total],
    ['Prontas para importar', preview.summary.valid],
    ['Duplicadas', preview.summary.duplicates],
    ['Inválidas', preview.summary.invalid],
    ['Com avisos', preview.summary.warnings],
  ];

  return (
    <section className="import-preview-section" aria-labelledby="import-preview-title">
      <div className="panel-heading">
        <div><p className="section-kicker">Pré-validação</p><h2 id="import-preview-title">Resultado da análise</h2></div>
        <span className="muted-copy">Formato: {preview.format}</span>
      </div>
      <div className="import-summary-grid">
        {cards.map(([label, value]) => <article className="metric-card" key={label}><strong>{value}</strong><span>{label}</span></article>)}
      </div>
      <div className="table-scroll import-preview-table-wrap">
        <table className="data-table import-preview-table">
          <thead><tr><th>Linha</th><th>Hostname</th><th>IP</th><th>Status</th><th>Motivo</th><th>Ação</th></tr></thead>
          <tbody>
            {preview.rows.map((row) => {
              const presentation = statusPresentation[row.status];
              const issues = [...row.errors, ...row.warnings];
              return (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td><strong>{row.hostname || 'Não informado'}</strong></td>
                  <td>{row.ipAddress || 'Não informado'}</td>
                  <td><span className={`status-badge ${presentation.className}`}>{presentation.label}</span></td>
                  <td>
                    {issues.length ? (
                      <ul className="import-issue-list">
                        {issues.map((issue) => <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>)}
                      </ul>
                    ) : 'Linha validada.'}
                  </td>
                  <td>
                    {row.existingAsset ? (
                      <Link className="table-action" href={`/assets/${row.existingAsset.id}`}>Ver ativo existente</Link>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="manual-form-actions">
        {canDownloadReport ? (
          <button className="button button-secondary" type="button" onClick={onDownloadReport}>
            Baixar relatório da análise
          </button>
        ) : null}
        <button
          className="button button-primary"
          type="button"
          disabled={!preview.summary.valid || committing}
          onClick={() => void onCommit()}
        >
          {committing ? 'Importando…' : `Importar ${preview.summary.valid} ativos válidos`}
        </button>
      </div>
    </section>
  );
}

function ImportResult({
  canDownloadReport,
  result,
  onDownloadReport,
}: {
  canDownloadReport: boolean;
  result: ImportAssetsCsvResponse;
  onDownloadReport: () => void;
}) {
  const hasCaveats = result.summary.skipped || result.summary.invalid || result.summary.failed || result.summary.warnings;
  return (
    <section className="form-message form-message-success import-result" role="status">
      <strong>{hasCaveats ? 'Importação concluída com ressalvas' : 'Importação concluída'}</strong>
      <div className="import-result-summary">
        <span>{result.summary.created} criado(s)</span>
        <span>{result.summary.skipped} duplicidade(s) ignorada(s)</span>
        <span>{result.summary.invalid} linha(s) inválida(s)</span>
        <span>{result.summary.warnings} aviso(s)</span>
        <span>{result.summary.failed} falha(s) inesperada(s)</span>
      </div>
      {hasCaveats ? (
        <details>
          <summary>Ver detalhes</summary>
          <ul className="csv-warning-list">
            {result.skippedRows.map((row) => <li key={`skip-${row.rowNumber}`}>Linha {row.rowNumber} — {row.hostname}: {row.reason}</li>)}
            {result.invalidRows.flatMap((row) => row.errors.map((issue) => <li key={`invalid-${row.rowNumber}-${issue.code}`}>Linha {row.rowNumber} — {row.hostname || 'hostname não informado'}: {issue.message}</li>))}
            {result.warnings.map((warning) => <li key={`warning-${warning.line}-${warning.code}`}>Linha {warning.line}: {warning.message}</li>)}
            {result.failedRows.map((row) => <li key={`failed-${row.rowNumber}`}>Linha {row.rowNumber} — {row.hostname}: {row.reason}</li>)}
          </ul>
        </details>
      ) : null}
      {canDownloadReport ? (
        <div className="manual-form-actions">
          <button className="button button-secondary" type="button" onClick={onDownloadReport}>
            Baixar relatório final
          </button>
        </div>
      ) : null}
    </section>
  );
}
