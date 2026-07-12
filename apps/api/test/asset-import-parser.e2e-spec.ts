import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

import { AssetImportParserService } from '../src/assets/asset-import-parser.service';

const parser = new AssetImportParserService();

async function workbookFile(
  extension: 'xlsx' | 'xlsm',
  rows: Array<Array<ExcelJS.CellValue>>,
  secondSheetRows: Array<Array<ExcelJS.CellValue>> = [],
): Promise<Express.Multer.File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ativos');
  rows.forEach((row) => sheet.addRow(row));
  if (secondSheetRows.length) {
    const second = workbook.addWorksheet('Ignorada');
    secondSheetRows.forEach((row) => second.addRow(row));
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    originalname: `ativos.${extension}`,
    mimetype:
      extension === 'xlsm'
        ? 'application/vnd.ms-excel.sheet.macroenabled.12'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

describe('Asset import parser security and formats', () => {
  it('keeps semicolon CSV compatibility and accepts UTF-8 BOM', () => {
    const parsed = parser.parseText('\uFEFFhostname;ipAddress;comment\nNB-01;10.20.0.1;Teste');
    expect(parsed.format).toBe('CSV');
    expect(parsed.rows[0]?.data).toEqual(
      expect.objectContaining({ hostname: 'NB-01', ipAddress: '10.20.0.1' }),
    );
  });

  it('detects pasted TAB-separated spreadsheet content', () => {
    const parsed = parser.parseText('hostname\tipAddress\toperatingSystem\nNB-02\t10.20.0.2\tWindows 11');
    expect(parsed.format).toBe('PASTED');
    expect(parsed.rows[0]?.data.operatingSystem).toBe('Windows 11');
  });

  it('rejects pasted content without required headers', () => {
    expect(() => parser.parseText('hostname\tcomment\nNB-03\tSem IP')).toThrow(BadRequestException);
  });

  it('rejects more than 500 useful text rows', () => {
    const rows = Array.from({ length: 501 }, (_, index) => `NB-${index};10.20.1.${(index % 250) + 1}`);
    expect(() => parser.parseText(['hostname;ipAddress', ...rows].join('\n'))).toThrow(
      '500 linhas úteis',
    );
  });

  it('reads only the first XLSX worksheet', async () => {
    const file = await workbookFile(
      'xlsx',
      [['hostname', 'ipAddress'], ['XLSX-FIRST', '10.30.0.1']],
      [['hostname', 'ipAddress'], ['XLSX-SECOND', '10.30.0.2']],
    );
    const parsed = await parser.parseSpreadsheet(file);
    expect(parsed.format).toBe('XLSX');
    expect(parsed.rows.map((row) => row.data.hostname)).toEqual(['XLSX-FIRST']);
  });

  it('rejects XLSX without required headers or useful rows', async () => {
    const missingHeader = await workbookFile('xlsx', [
      ['hostname', 'comment'],
      ['XLSX-NO-IP', 'Sem coluna de IP'],
    ]);
    await expect(parser.parseSpreadsheet(missingHeader)).rejects.toThrow('ipAddress');

    const empty = await workbookFile('xlsx', [['hostname', 'ipAddress']]);
    await expect(parser.parseSpreadsheet(empty)).rejects.toThrow('ao menos uma linha');
  });

  it('uses only the stored result of formulas without evaluating expressions', async () => {
    const file = await workbookFile('xlsx', [
      ['hostname', 'ipAddress', 'comment'],
      ['XLSX-FORMULA', '10.30.0.3', { formula: '1+1', result: 2 }],
    ]);
    const parsed = await parser.parseSpreadsheet(file);
    expect(parsed.rows[0]?.data.comment).toBe('2');
    expect(parsed.rows[0]?.data.comment).not.toContain('1+1');
  });

  it('accepts XLSM as tabular data without interpreting macros', async () => {
    const file = await workbookFile('xlsm', [
      ['hostname', 'ipAddress'],
      ['XLSM-01', '10.30.0.4'],
    ]);
    await expect(parser.parseSpreadsheet(file)).resolves.toEqual(
      expect.objectContaining({ format: 'XLSM' }),
    );
  });

  it('rejects corrupted, unsupported, empty and oversized files', async () => {
    const base = {
      originalname: 'ativos.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    await expect(
      parser.parseSpreadsheet({ ...base, size: 4, buffer: Buffer.from('nope') } as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);
    await expect(
      parser.parseSpreadsheet({ ...base, originalname: 'ativos.ods', size: 4, buffer: Buffer.from('PK00') } as Express.Multer.File),
    ).rejects.toThrow('Formato não suportado');
    await expect(
      parser.parseSpreadsheet({ ...base, size: 0, buffer: Buffer.alloc(0) } as Express.Multer.File),
    ).rejects.toThrow('vazio');
    await expect(
      parser.parseSpreadsheet({ ...base, size: 2 * 1024 * 1024 + 1, buffer: Buffer.alloc(2 * 1024 * 1024 + 1) } as Express.Multer.File),
    ).rejects.toThrow('2 MB');
  });

  it('rejects spreadsheets above row and column limits', async () => {
    const tooManyRows = await workbookFile('xlsx', [
      ['hostname', 'ipAddress'],
      ...Array.from({ length: 501 }, (_, index) => [`ROW-${index}`, `10.40.${Math.floor(index / 250)}.${(index % 250) + 1}`]),
    ]);
    await expect(parser.parseSpreadsheet(tooManyRows)).rejects.toThrow('500 linhas úteis');

    const tooManyColumns = await workbookFile('xlsx', [
      Array.from({ length: 31 }, (_, index) => (index === 0 ? 'hostname' : index === 1 ? 'ipAddress' : `extra${index}`)),
      Array.from({ length: 31 }, (_, index) => (index === 0 ? 'NB-COLS' : index === 1 ? '10.40.0.1' : 'x')),
    ]);
    await expect(parser.parseSpreadsheet(tooManyColumns)).rejects.toThrow('30 colunas');
  });
});
