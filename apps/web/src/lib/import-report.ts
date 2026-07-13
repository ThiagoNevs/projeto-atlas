export const IMPORT_REPORT_ERROR_MESSAGE =
  'Não foi possível gerar o relatório. Tente novamente.';

const ANALYSIS_HEADERS = [
  'Linha',
  'Hostname',
  'IP',
  'Classificação',
  'Importável',
  'Avisos',
  'Erros',
  'Motivo',
  'Ativo existente',
  'ID do ativo existente',
] as const;

const FINAL_HEADERS = [
  'Linha',
  'Hostname',
  'IP',
  'Classificação da análise',
  'Resultado final',
  'Importado',
  'Avisos',
  'Erros',
  'Motivo',
  'ID do ativo criado',
  'Ativo existente',
  'ID do ativo existente',
] as const;

export type ImportReportRowStatus =
  | 'VALID'
  | 'INVALID'
  | 'DUPLICATE'
  | 'VALID_WITH_WARNINGS';

export interface ImportReportIssue {
  line: number;
  rowNumber?: number;
  field: string;
  code?: string;
  message: string;
}

export interface ImportReportPreviewRow {
  rowNumber: number;
  hostname: string;
  ipAddress: string;
  status: ImportReportRowStatus;
  errors: ImportReportIssue[];
  warnings: ImportReportIssue[];
  existingAsset?: {
    id: string;
    hostname: string;
    primaryIp: string | null;
  };
}

export interface ImportReportPreview {
  rows: ImportReportPreviewRow[];
}

export interface ImportReportResult {
  createdRows: Array<{
    rowNumber: number;
    hostname: string;
    ipAddress: string;
    assetId: string;
  }>;
  skippedRows: Array<{
    rowNumber: number;
    hostname: string;
    ipAddress: string;
    reason: string;
    existingAssetId: string | null;
  }>;
  invalidRows: Array<{
    rowNumber: number;
    hostname: string;
    ipAddress: string;
    errors: ImportReportIssue[];
  }>;
  failedRows: Array<{
    rowNumber: number;
    hostname: string;
    ipAddress: string;
    reason: string;
  }>;
  warnings: ImportReportIssue[];
}

const CLASSIFICATION_LABELS: Record<ImportReportRowStatus, string> = {
  VALID: 'Pronto para importar',
  VALID_WITH_WARNINGS: 'Importável com aviso',
  DUPLICATE: 'Duplicado',
  INVALID: 'Linha inválida',
};

function messages(issues: ImportReportIssue[]): string {
  return issues.map((issue) => issue.message).filter(Boolean).join(' | ');
}

function firstMeaningful(...values: string[]): string {
  return values.find((value) => value.trim()) ?? '';
}

export function protectCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value: unknown): string {
  return `"${protectCsvCell(value).replace(/"/g, '""')}"`;
}

export function serializeCsv(headers: readonly string[], rows: unknown[][]): string {
  return `\uFEFF${[
    headers.map((header) => `"${header.replace(/"/g, '""')}"`).join(';'),
    ...rows.map((row) => row.map(escapeCsvCell).join(';')),
  ].join('\r\n')}`;
}

export function buildImportAnalysisCsv(preview: ImportReportPreview): string {
  const rows = preview.rows.map((row) => {
    const warningMessages = messages(row.warnings);
    const errorMessages = messages(row.errors);
    return [
      row.rowNumber,
      row.hostname,
      row.ipAddress,
      CLASSIFICATION_LABELS[row.status],
      ['VALID', 'VALID_WITH_WARNINGS'].includes(row.status) ? 'Sim' : 'Não',
      warningMessages,
      errorMessages,
      firstMeaningful(errorMessages, warningMessages),
      row.existingAsset?.hostname ?? '',
      row.existingAsset?.id ?? '',
    ];
  });

  return serializeCsv(ANALYSIS_HEADERS, rows);
}

export function buildImportFinalCsv(
  preview: ImportReportPreview,
  result: ImportReportResult,
): string {
  const createdByRow = new Map(result.createdRows.map((row) => [row.rowNumber, row]));
  const skippedByRow = new Map(result.skippedRows.map((row) => [row.rowNumber, row]));
  const invalidByRow = new Map(result.invalidRows.map((row) => [row.rowNumber, row]));
  const failedByRow = new Map(result.failedRows.map((row) => [row.rowNumber, row]));
  const warningsByRow = new Map<number, ImportReportIssue[]>();

  for (const warning of result.warnings) {
    const rowNumber = warning.rowNumber ?? warning.line;
    warningsByRow.set(rowNumber, [...(warningsByRow.get(rowNumber) ?? []), warning]);
  }

  const rows = preview.rows.map((row) => {
    const created = createdByRow.get(row.rowNumber);
    const skipped = skippedByRow.get(row.rowNumber);
    const invalid = invalidByRow.get(row.rowNumber);
    const failed = failedByRow.get(row.rowNumber);
    const finalWarnings = warningsByRow.get(row.rowNumber) ?? row.warnings;
    const warningMessages = messages(finalWarnings);
    const invalidMessages = messages(invalid?.errors ?? row.errors);

    let finalResult = 'Falha na importação';
    let imported = 'Não';
    let reason = 'Resultado final não informado pelo servidor.';
    let errorMessages = invalidMessages;
    let createdAssetId = '';
    let existingAssetName = row.existingAsset?.hostname ?? '';
    let existingAssetId = row.existingAsset?.id ?? '';

    if (created) {
      finalResult = warningMessages ? 'Criado com aviso' : 'Criado';
      imported = 'Sim';
      reason = warningMessages;
      createdAssetId = created.assetId;
    } else if (skipped) {
      finalResult = 'Ignorado por duplicidade';
      reason = skipped.reason;
      existingAssetName ||= skipped.hostname;
      existingAssetId ||= skipped.existingAssetId ?? '';
    } else if (invalid) {
      finalResult = 'Linha inválida';
      reason = invalidMessages;
    } else if (failed) {
      finalResult = 'Falha na importação';
      reason = failed.reason;
      errorMessages = failed.reason;
    }

    return [
      row.rowNumber,
      row.hostname,
      row.ipAddress,
      CLASSIFICATION_LABELS[row.status],
      finalResult,
      imported,
      warningMessages,
      errorMessages,
      reason,
      createdAssetId,
      existingAssetName,
      existingAssetId,
    ];
  });

  return serializeCsv(FINAL_HEADERS, rows);
}

export function importReportAvailability(
  preview: ImportReportPreview | null,
  result: ImportReportResult | null,
): { analysis: boolean; final: boolean } {
  return { analysis: preview !== null, final: result !== null };
}

export function attemptImportReportDownload(download: () => void): string | null {
  try {
    download();
    return null;
  } catch {
    return IMPORT_REPORT_ERROR_MESSAGE;
  }
}

export function buildImportReportFilename(
  type: 'analysis' | 'final',
  date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const prefix = type === 'analysis' ? 'atlas-analise-importacao' : 'atlas-resultado-importacao';
  return `${prefix}-${timestamp}.csv`;
}
