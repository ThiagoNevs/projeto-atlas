import { describe, expect, it } from '@jest/globals';

import {
  attemptImportReportDownload,
  buildImportAnalysisCsv,
  buildImportFinalCsv,
  buildImportReportFilename,
  escapeCsvCell,
  IMPORT_REPORT_ERROR_MESSAGE,
  importReportAvailability,
  protectCsvCell,
  serializeCsv,
} from '../../web/src/lib/import-report';
import type {
  ImportReportIssue,
  ImportReportPreview,
  ImportReportPreviewRow,
  ImportReportResult,
} from '../../web/src/lib/import-report';

const issue = (message: string, line = 2): ImportReportIssue => ({
  line,
  rowNumber: line,
  field: 'ipAddress',
  code: 'TEST_ISSUE',
  message,
});

const previewRow = (
  overrides: Partial<ImportReportPreviewRow> = {},
): ImportReportPreviewRow => ({
  rowNumber: 2,
  hostname: 'NB-RH-001',
  ipAddress: '10.20.1.15',
  status: 'VALID',
  errors: [],
  warnings: [],
  ...overrides,
});

const preview = (...rows: ImportReportPreviewRow[]): ImportReportPreview => ({ rows });

const result = (overrides: Partial<ImportReportResult> = {}): ImportReportResult => ({
  createdRows: [],
  skippedRows: [],
  invalidRows: [],
  failedRows: [],
  warnings: [],
  ...overrides,
});

const finalReportRow = (csv: string, rowNumber: number): string[] => {
  const line = csv.split('\r\n').find((candidate) => candidate.startsWith(`"${rowNumber}";`));
  expect(line).toBeDefined();
  return line!.split(';').map((cell) => cell.slice(1, -1).replace(/""/g, '"'));
};

describe('Import CSV reports', () => {
  it('exports a row ready for import', () => {
    const csv = buildImportAnalysisCsv(preview(previewRow()));
    expect(csv).toContain('"Pronto para importar";"Sim"');
  });

  it('exports a row with warning', () => {
    const csv = buildImportAnalysisCsv(
      preview(previewRow({ status: 'VALID_WITH_WARNINGS', warnings: [issue('IP compartilhado.')] })),
    );
    expect(csv).toContain('"Importável com aviso";"Sim";"IP compartilhado."');
  });

  it('exports a duplicate row', () => {
    const csv = buildImportAnalysisCsv(
      preview(previewRow({ status: 'DUPLICATE', errors: [issue('Hostname já cadastrado.')] })),
    );
    expect(csv).toContain('"Duplicado";"Não"');
  });

  it('exports an invalid row', () => {
    const csv = buildImportAnalysisCsv(
      preview(previewRow({ status: 'INVALID', errors: [issue('IP inválido.')] })),
    );
    expect(csv).toContain('"Linha inválida";"Não"');
  });

  it('preserves the original spreadsheet row number', () => {
    const csv = buildImportAnalysisCsv(preview(previewRow({ rowNumber: 37 })));
    expect(csv).toContain('\r\n"37";');
  });

  it('includes the existing asset when applicable', () => {
    const csv = buildImportAnalysisCsv(
      preview(
        previewRow({
          status: 'DUPLICATE',
          existingAsset: { id: 'asset-existing', hostname: 'NB-RH-001', primaryIp: '10.20.1.15' },
        }),
      ),
    );
    expect(csv).toContain('"NB-RH-001";"asset-existing"');
  });

  it('exports a created row', () => {
    const csv = buildImportFinalCsv(
      preview(previewRow()),
      result({ createdRows: [{ rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', assetId: 'new-asset' }] }),
    );
    expect(csv).toContain('"Criado";"Sim"');
  });

  it('exports a row created with warning', () => {
    const warning = issue('IP compartilhado.');
    const csv = buildImportFinalCsv(
      preview(previewRow({ status: 'VALID_WITH_WARNINGS', warnings: [warning] })),
      result({
        createdRows: [{ rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', assetId: 'new-asset' }],
        warnings: [warning],
      }),
    );
    expect(csv).toContain('"Criado com aviso";"Sim";"IP compartilhado."');
  });

  it('does not reuse a preview warning removed by commit revalidation', () => {
    const previewWarning = issue('Aviso antigo do preview.');
    const csv = buildImportFinalCsv(
      preview(previewRow({ status: 'VALID_WITH_WARNINGS', warnings: [previewWarning] })),
      result({
        createdRows: [
          { rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', assetId: 'new-asset' },
        ],
        warnings: [],
      }),
    );
    const row = finalReportRow(csv, 2);

    expect(row[4]).toBe('Criado');
    expect(row[5]).toBe('Sim');
    expect(row[6]).toBe('');
    expect(csv).not.toContain(previewWarning.message);
  });

  it('uses a warning introduced by commit revalidation', () => {
    const commitWarning = issue('Aviso novo do commit.');
    const csv = buildImportFinalCsv(
      preview(previewRow()),
      result({
        createdRows: [
          { rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', assetId: 'new-asset' },
        ],
        warnings: [commitWarning],
      }),
    );
    const row = finalReportRow(csv, 2);

    expect(row[4]).toBe('Criado com aviso');
    expect(row[6]).toBe(commitWarning.message);
  });

  it('generates a final report without createdRows during a decoupled rollout', () => {
    const csv = buildImportFinalCsv(
      preview(previewRow()),
      result({ createdRows: undefined, createdCount: 1, summary: { created: 1 } }),
    );
    const row = finalReportRow(csv, 2);

    expect(row[4]).toBe('Criado');
    expect(row[5]).toBe('Sim');
    expect(row[9]).toBe('');
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('[object Object]');
  });

  it('keeps other outcomes when createdRows is absent', () => {
    const invalidIssue = issue('IP inválido.', 4);
    const csv = buildImportFinalCsv(
      preview(
        previewRow(),
        previewRow({ rowNumber: 3, hostname: 'DUPLICATE-01', status: 'DUPLICATE' }),
        previewRow({ rowNumber: 4, hostname: 'INVALID-01', status: 'INVALID', errors: [invalidIssue] }),
      ),
      result({
        createdRows: undefined,
        createdCount: 1,
        summary: { created: 1 },
        skippedRows: [
          {
            rowNumber: 3,
            hostname: 'DUPLICATE-01',
            ipAddress: '10.20.1.15',
            reason: 'Hostname já cadastrado.',
            existingAssetId: 'existing-id',
          },
        ],
        invalidRows: [
          {
            rowNumber: 4,
            hostname: 'INVALID-01',
            ipAddress: '999.1.1.1',
            errors: [invalidIssue],
          },
        ],
      }),
    );

    expect(csv.split('\r\n')).toHaveLength(4);
    expect(finalReportRow(csv, 2)[4]).toBe('Criado');
    expect(finalReportRow(csv, 2)[9]).toBe('');
    expect(finalReportRow(csv, 3)[4]).toBe('Ignorado por duplicidade');
    expect(finalReportRow(csv, 4)[4]).toBe('Linha inválida');
  });

  it('keeps row correlation after an unexpected intermediate failure', () => {
    const csv = buildImportFinalCsv(
      preview(
        previewRow({ rowNumber: 2, hostname: 'CREATED-BEFORE' }),
        previewRow({ rowNumber: 3, hostname: 'FAILED-MIDDLE' }),
        previewRow({ rowNumber: 4, hostname: 'CREATED-AFTER' }),
      ),
      result({
        createdRows: [
          { rowNumber: 2, hostname: 'CREATED-BEFORE', ipAddress: '10.20.1.15', assetId: 'asset-before' },
          { rowNumber: 4, hostname: 'CREATED-AFTER', ipAddress: '10.20.1.15', assetId: 'asset-after' },
        ],
        failedRows: [
          {
            rowNumber: 3,
            hostname: 'FAILED-MIDDLE',
            ipAddress: '10.20.1.15',
            reason: 'Falha segura.',
          },
        ],
      }),
    );

    expect(finalReportRow(csv, 2)[9]).toBe('asset-before');
    expect(finalReportRow(csv, 3)[4]).toBe('Falha na importação');
    expect(finalReportRow(csv, 3)[9]).toBe('');
    expect(finalReportRow(csv, 4)[9]).toBe('asset-after');
  });

  it('exports a row ignored because of duplication', () => {
    const csv = buildImportFinalCsv(
      preview(previewRow({ status: 'DUPLICATE' })),
      result({
        skippedRows: [{ rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', reason: 'Hostname já cadastrado.', existingAssetId: 'existing-id' }],
      }),
    );
    expect(csv).toContain('"Ignorado por duplicidade";"Não"');
  });

  it('exports an invalid row in the final report', () => {
    const invalidIssue = issue('IP inválido.');
    const csv = buildImportFinalCsv(
      preview(previewRow({ status: 'INVALID', errors: [invalidIssue] })),
      result({ invalidRows: [{ rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '999.1.1.1', errors: [invalidIssue] }] }),
    );
    expect(csv).toContain('"Linha inválida";"Não"');
  });

  it('exports an unexpected row failure', () => {
    const csv = buildImportFinalCsv(
      preview(previewRow()),
      result({ failedRows: [{ rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', reason: 'Falha segura.' }] }),
    );
    expect(csv).toContain('"Falha na importação";"Não"');
    expect(csv).toContain('"Falha segura."');
  });

  it('includes the created asset id when available', () => {
    const csv = buildImportFinalCsv(
      preview(previewRow()),
      result({ createdRows: [{ rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', assetId: 'created-id' }] }),
    );
    expect(csv).toContain('"created-id"');
  });

  it('preserves accented characters', () => {
    expect(serializeCsv(['Descrição'], [['Importação concluída em São Paulo']])).toContain(
      'Importação concluída em São Paulo',
    );
  });

  it('escapes cells containing semicolons', () => {
    expect(escapeCsvCell('Rio; São Paulo')).toBe('"Rio; São Paulo"');
  });

  it('escapes cells containing quotes', () => {
    expect(escapeCsvCell('Servidor "principal"')).toBe('"Servidor ""principal"""');
  });

  it('preserves line breaks inside quoted cells', () => {
    expect(escapeCsvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
  });

  it('serializes empty fields without undefined or null text', () => {
    const csv = serializeCsv(['A', 'B', 'C'], [[null, undefined, '']]);
    expect(csv).toContain('\r\n"";"";""');
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('null');
  });

  it('serializes an unexpected object as an empty cell', () => {
    const csv = serializeCsv(['Valor'], [[{ internal: 'value' }]]);
    expect(csv).toContain('\r\n""');
    expect(csv).not.toContain('[object Object]');
    expect(csv).not.toContain('internal');
  });

  it('serializes arrays using only controlled primitive values', () => {
    expect(protectCsvCell(['texto', 2, true, { internal: 'value' }])).toBe(
      'texto | 2 | true | ',
    );
  });

  it('keeps null and undefined as empty protected values', () => {
    expect(protectCsvCell(null)).toBe('');
    expect(protectCsvCell(undefined)).toBe('');
  });

  it('protects a formula after controlled array conversion', () => {
    expect(protectCsvCell(['=1+1', 'texto'])).toBe("'=1+1 | texto");
  });

  it('joins multiple warnings and errors with a readable separator', () => {
    const csv = buildImportAnalysisCsv(
      preview(
        previewRow({
          status: 'INVALID',
          warnings: [issue('Aviso um.'), issue('Aviso dois.')],
          errors: [issue('Erro um.'), issue('Erro dois.')],
        }),
      ),
    );
    expect(csv).toContain('Aviso um. | Aviso dois.');
    expect(csv).toContain('Erro um. | Erro dois.');
  });

  it('adds the UTF-8 BOM', () => {
    expect(serializeCsv(['Coluna'], [['valor']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('keeps report columns in a stable order', () => {
    const analysisHeader = buildImportAnalysisCsv(preview()).split('\r\n')[0];
    const finalHeader = buildImportFinalCsv(preview(), result()).split('\r\n')[0];
    expect(analysisHeader).toBe(
      '\uFEFF"Linha";"Hostname";"IP";"Classificação";"Importável";"Avisos";"Erros";"Motivo";"Ativo existente";"ID do ativo existente"',
    );
    expect(finalHeader).toBe(
      '\uFEFF"Linha";"Hostname";"IP";"Classificação da análise";"Resultado final";"Importado";"Avisos";"Erros";"Motivo";"ID do ativo criado";"Ativo existente";"ID do ativo existente"',
    );
  });

  it('protects a value starting with equals', () => {
    expect(protectCsvCell('=HYPERLINK("https://exemplo.invalid")')).toMatch(/^'=/);
  });

  it('protects a value starting with plus', () => {
    expect(protectCsvCell('+CMD')).toBe("'+CMD");
  });

  it('protects a value starting with minus', () => {
    expect(protectCsvCell('-CMD')).toBe("'-CMD");
  });

  it('protects a value starting with at sign', () => {
    expect(protectCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
  });

  it('protects a formula preceded by spaces without discarding content', () => {
    expect(protectCsvCell('   =1+1')).toBe("'   =1+1");
  });

  it('does not apply cell sanitization to controlled headers', () => {
    expect(serializeCsv(['-Cabeçalho controlado'], [])).toBe('\uFEFF"-Cabeçalho controlado"');
  });

  it('makes the analysis report available after an all-invalid preview', () => {
    const invalidPreview = preview(previewRow({ status: 'INVALID' }));
    expect(importReportAvailability(invalidPreview, null)).toEqual({ analysis: true, final: false });
  });

  it('makes the final report available after commit', () => {
    expect(importReportAvailability(null, result())).toEqual({ analysis: false, final: true });
  });

  it('keeps both report actions unavailable before their results', () => {
    expect(importReportAvailability(null, null)).toEqual({ analysis: false, final: false });
  });

  it('does not mutate displayed results while generating a report', () => {
    const sourcePreview = preview(previewRow({ warnings: [issue('Aviso preservado.')] }));
    const sourceResult = result({ createdRows: [{ rowNumber: 2, hostname: 'NB-RH-001', ipAddress: '10.20.1.15', assetId: 'asset-id' }] });
    const before = JSON.stringify({ sourcePreview, sourceResult });
    buildImportAnalysisCsv(sourcePreview);
    buildImportFinalCsv(sourcePreview, sourceResult);
    expect(JSON.stringify({ sourcePreview, sourceResult })).toBe(before);
  });

  it('provides the controlled Portuguese report error message', () => {
    expect(IMPORT_REPORT_ERROR_MESSAGE).toBe('Não foi possível gerar o relatório. Tente novamente.');
    expect(
      attemptImportReportDownload(() => {
        throw new Error('Browser failure');
      }),
    ).toBe(IMPORT_REPORT_ERROR_MESSAGE);
  });

  it('clears a previous report error after a successful download attempt', () => {
    expect(attemptImportReportDownload(() => undefined)).toBeNull();
  });

  it('builds local timestamped filenames without asset data', () => {
    const date = new Date(2026, 6, 13, 9, 5);
    expect(buildImportReportFilename('analysis', date)).toBe('atlas-analise-importacao-2026-07-13-0905.csv');
    expect(buildImportReportFilename('final', date)).toBe('atlas-resultado-importacao-2026-07-13-0905.csv');
  });
});
