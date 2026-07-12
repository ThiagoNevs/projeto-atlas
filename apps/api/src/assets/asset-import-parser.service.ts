import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { basename, extname } from 'node:path';
import * as yauzl from 'yauzl';

export const ASSET_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const ASSET_IMPORT_MAX_ROWS = 500;
export const ASSET_IMPORT_MAX_COLUMNS = 30;
const ASSET_IMPORT_MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const ASSET_IMPORT_MAX_ZIP_ENTRIES = 1_000;
const ASSET_IMPORT_MAX_COMPRESSION_RATIO = 200;

export const ASSET_IMPORT_REQUIRED_HEADERS = ['hostname', 'ipAddress'] as const;
export const ASSET_IMPORT_ALLOWED_HEADERS = [
  'hostname',
  'ipAddress',
  'operatingSystem',
  'osVersion',
  'location',
  'owner',
  'department',
  'type',
  'administrativeStatus',
  'manufacturer',
  'model',
  'serialNumber',
  'macAddress',
  'environment',
  'criticality',
  'comment',
] as const;

export type AssetImportHeader = (typeof ASSET_IMPORT_ALLOWED_HEADERS)[number];
export type AssetImportRow = Record<AssetImportHeader, string>;
export type AssetImportFormat = 'CSV' | 'PASTED' | 'XLSX' | 'XLSM';
export type ParsedAssetImport = {
  format: AssetImportFormat;
  rows: Array<{ line: number; data: AssetImportRow }>;
  fileName?: string;
};

type TabularRecord = { line: number; cells: string[] };

@Injectable()
export class AssetImportParserService {
  parseText(content: string): ParsedAssetImport {
    if (Buffer.byteLength(content, 'utf8') > ASSET_IMPORT_MAX_FILE_BYTES) {
      throw new BadRequestException('O conteúdo da importação excede o limite de 2 MB.');
    }
    const normalizedContent = content.replace(/^\uFEFF/, '');
    if (!normalizedContent.trim()) {
      throw new BadRequestException('A importação precisa conter cabeçalho e dados.');
    }
    const delimiter = this.detectDelimiter(normalizedContent);
    const format: AssetImportFormat = delimiter === '\t' ? 'PASTED' : 'CSV';
    return { format, rows: this.normalizeRecords(this.parseDelimited(normalizedContent, delimiter)) };
  }

  async parseSpreadsheet(file: Express.Multer.File | undefined): Promise<ParsedAssetImport> {
    if (!file) throw new BadRequestException('Selecione um arquivo XLSX ou XLSM.');
    this.validateFileMetadata(file);
    await this.inspectOfficeZip(file.buffer);

    const workbook = new ExcelJS.Workbook();
    try {
      const workbookBuffer = Uint8Array.from(file.buffer).buffer;
      await workbook.xlsx.load(workbookBuffer, {
        ignoreNodes: ['dataValidations', 'drawing', 'hyperlinks', 'picture'],
      });
    } catch {
      throw new BadRequestException('O arquivo está corrompido ou não é uma planilha Office válida.');
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('A planilha não possui uma aba legível.');
    if (worksheet.columnCount > ASSET_IMPORT_MAX_COLUMNS) {
      throw new BadRequestException(`A planilha excede o limite de ${ASSET_IMPORT_MAX_COLUMNS} colunas.`);
    }
    if (worksheet.rowCount > ASSET_IMPORT_MAX_ROWS + 1_500) {
      throw new BadRequestException('A planilha possui uma quantidade excessiva de linhas físicas.');
    }

    const records: TabularRecord[] = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const cells = Array.from({ length: worksheet.columnCount }, (_, index) =>
        this.storedCellValue(row.getCell(index + 1).value),
      );
      if (cells.every((cell) => !cell.trim())) continue;
      records.push({ line: rowNumber, cells });
    }

    const extension = extname(file.originalname).toLocaleLowerCase();
    return {
      format: extension === '.xlsm' ? 'XLSM' : 'XLSX',
      fileName: basename(file.originalname),
      rows: this.normalizeRecords(records),
    };
  }

  private normalizeRecords(records: TabularRecord[]): ParsedAssetImport['rows'] {
    const [headerRecord, ...dataRecords] = records;
    if (!headerRecord) throw new BadRequestException('A importação precisa conter cabeçalho.');
    if (headerRecord.cells.length > ASSET_IMPORT_MAX_COLUMNS) {
      throw new BadRequestException(`A importação excede o limite de ${ASSET_IMPORT_MAX_COLUMNS} colunas.`);
    }

    const headers = headerRecord.cells.map((header) => this.normalizeHeader(header));
    const missingHeaders = ASSET_IMPORT_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
    if (missingHeaders.length) {
      throw new BadRequestException(
        `A importação precisa conter os headers obrigatórios: ${missingHeaders.join(', ')}.`,
      );
    }
    const allowedHeaders = ASSET_IMPORT_ALLOWED_HEADERS as readonly string[];
    const unknownHeaders = headers.filter((header) => !allowedHeaders.includes(header));
    if (unknownHeaders.length) {
      throw new BadRequestException(
        `A importação contém headers não suportados: ${unknownHeaders.join(', ')}.`,
      );
    }

    const rows = dataRecords.flatMap((record) => {
      if (record.cells.every((cell) => !cell.trim())) return [];
      const data = Object.fromEntries(
        ASSET_IMPORT_ALLOWED_HEADERS.map((header) => [header, '']),
      ) as AssetImportRow;
      headers.forEach((header, index) => {
        if (allowedHeaders.includes(header)) {
          data[header as AssetImportHeader] = record.cells[index]?.trim() ?? '';
        }
      });
      return [{ line: record.line, data }];
    });

    if (!rows.length) throw new BadRequestException('A importação precisa conter ao menos uma linha de ativo.');
    if (rows.length > ASSET_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`A importação excede o limite de ${ASSET_IMPORT_MAX_ROWS} linhas úteis.`);
    }
    return rows;
  }

  private parseDelimited(content: string, delimiter: '\t' | ';' | ','): TabularRecord[] {
    const records: TabularRecord[] = [];
    let cells: string[] = [];
    let cell = '';
    let inQuotes = false;
    let line = 1;
    let recordLine = 1;

    for (let index = 0; index < content.length; index += 1) {
      const char = content[index];
      const nextChar = content[index + 1];
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (!inQuotes && char === delimiter) {
        cells.push(cell);
        cell = '';
        continue;
      }
      if (!inQuotes && (char === '\n' || char === '\r')) {
        cells.push(cell);
        records.push({ line: recordLine, cells });
        cells = [];
        cell = '';
        if (char === '\r' && nextChar === '\n') index += 1;
        line += 1;
        recordLine = line;
        continue;
      }
      if (char === '\n') line += 1;
      cell += char;
    }
    if (inQuotes) throw new BadRequestException('A importação contém um campo entre aspas não finalizado.');
    if (cell || cells.length) {
      cells.push(cell);
      records.push({ line: recordLine, cells });
    }
    return records;
  }

  private detectDelimiter(content: string): '\t' | ';' | ',' {
    const firstRecord = content.split(/\r?\n/, 1)[0] ?? '';
    const counts = { '\t': 0, ';': 0, ',': 0 };
    let inQuotes = false;
    for (let index = 0; index < firstRecord.length; index += 1) {
      const char = firstRecord[index];
      if (char === '"') {
        if (inQuotes && firstRecord[index + 1] === '"') index += 1;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && (char === '\t' || char === ';' || char === ',')) {
        counts[char] += 1;
      }
    }
    if (counts['\t'] > 0) return '\t';
    return counts[';'] >= counts[','] ? ';' : ',';
  }

  private normalizeHeader(header: string): string {
    const normalized = header.trim().replace(/^\uFEFF/, '').replace(/[^a-zA-Z0-9]/g, '').toLocaleLowerCase();
    return (
      ASSET_IMPORT_ALLOWED_HEADERS.find((allowed) => allowed.toLocaleLowerCase() === normalized) ??
      header.trim()
    );
  }

  private storedCellValue(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    if ('formula' in value) return this.storedCellValue(value.result ?? null);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    return '';
  }

  private validateFileMetadata(file: Express.Multer.File): void {
    if (!file.size || !file.buffer.length) throw new BadRequestException('O arquivo enviado está vazio.');
    if (file.size > ASSET_IMPORT_MAX_FILE_BYTES) throw new BadRequestException('O arquivo excede o limite de 2 MB.');
    if (basename(file.originalname) !== file.originalname || file.originalname.includes('..')) {
      throw new BadRequestException('O nome do arquivo é inválido.');
    }
    const extension = extname(file.originalname).toLocaleLowerCase();
    if (!['.xlsx', '.xlsm'].includes(extension)) {
      throw new BadRequestException('Formato não suportado. Envie um arquivo XLSX ou XLSM.');
    }
    const expectedMime = extension === '.xlsm'
      ? 'application/vnd.ms-excel.sheet.macroenabled.12'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const mime = file.mimetype.toLocaleLowerCase();
    if (mime !== expectedMime && mime !== 'application/octet-stream') {
      throw new BadRequestException('O tipo MIME do arquivo não corresponde ao formato informado.');
    }
    if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
      throw new BadRequestException('O conteúdo do arquivo não corresponde a uma planilha Office válida.');
    }
  }

  private inspectOfficeZip(buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipFile) => {
        if (error || !zipFile) {
          reject(new BadRequestException('O arquivo Office está corrompido.'));
          return;
        }
        let entries = 0;
        let totalUncompressed = 0;
        let hasWorkbook = false;
        const fail = (message: string) => {
          zipFile.close();
          reject(new BadRequestException(message));
        };
        zipFile.on('entry', (entry: yauzl.Entry) => {
          entries += 1;
          const normalizedName = entry.fileName.replaceAll('\\', '/');
          if (normalizedName.startsWith('/') || normalizedName.split('/').includes('..')) {
            fail('O arquivo Office contém caminhos internos inválidos.');
            return;
          }
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            fail('Planilhas Office criptografadas não são suportadas.');
            return;
          }
          totalUncompressed += entry.uncompressedSize;
          const ratio = entry.compressedSize
            ? entry.uncompressedSize / entry.compressedSize
            : entry.uncompressedSize;
          if (
            entries > ASSET_IMPORT_MAX_ZIP_ENTRIES ||
            totalUncompressed > ASSET_IMPORT_MAX_UNCOMPRESSED_BYTES ||
            ratio > ASSET_IMPORT_MAX_COMPRESSION_RATIO
          ) {
            fail('O arquivo Office excede os limites seguros de descompactação.');
            return;
          }
          if (normalizedName === 'xl/workbook.xml') hasWorkbook = true;
          zipFile.readEntry();
        });
        zipFile.once('error', () => reject(new BadRequestException('O arquivo Office está corrompido.')));
        zipFile.once('end', () => {
          if (!hasWorkbook) reject(new BadRequestException('O arquivo não contém uma planilha Office válida.'));
          else resolve();
        });
        zipFile.readEntry();
      });
    });
  }
}
