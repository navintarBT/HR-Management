// Files for the ສົ່ງອອກ buttons: a plain CSV, and an Excel workbook laid out
// like the page's print — the ROMEO title line, a coloured header row, cells
// in the page's colours, the first columns and the header kept in view.
// exceljs is large, so it's only loaded when someone actually exports.

export type SheetCell = {
  value: string | number | null | undefined;
  fill?: string; // #rrggbb
  color?: string; // #rrggbb
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  // Excel number format, e.g. '0.0', or '0;-0;"-"' to show a zero as "-"
  // while it still adds up.
  numFmt?: string;
};
type CellInput = SheetCell | string | number | null | undefined;

export type SheetColumn = { header: string; width: number; fill?: string; color?: string };

export type SheetSpec = {
  fileName: string; // without the extension
  sheetName: string;
  title: string;
  printedAt: string;
  columns: SheetColumn[];
  rows: CellInput[][];
  // The first this many columns stay in view when scrolling sideways.
  frozenColumns?: number;
  legend?: { label: string; text: string; fill?: string; color?: string }[];
  // A closing ລວມ row, styled like the header.
  totals?: CellInput[];
  // Every other row lightly shaded (cells with their own fill keep it).
  striped?: boolean;
};

const HEADER_FILL = '#FBF3E0';
const HEADER_TEXT = '#5C4315';
const TITLE_RULE = '#A9761E';
const STRIPE_FILL = '#FAFAFA';

const asCell = (input: CellInput): SheetCell => (input !== null && typeof input === 'object' ? input : { value: input });

// Only real colours carry over: "transparent"/"inherit" (or none) leave the cell plain.
const argb = (hex?: string) => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? `FF${hex.slice(1).toUpperCase()}` : undefined);

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// The same table as the workbook, as text: the title and print time first, then
// the header row and the rows. With a BOM so Excel reads the Lao as UTF-8.
export function downloadCsv(spec: SheetSpec) {
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    [spec.title],
    [`ພິມ: ${spec.printedAt}`],
    [],
    spec.columns.map((c) => c.header),
    ...spec.rows.map((row) => row.map((cell) => asCell(cell).value)),
    ...(spec.totals ? [spec.totals.map((cell) => asCell(cell).value)] : []),
  ].map((line) => line.map(quote).join(','));
  download(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' }), `${spec.fileName}.csv`);
}

export async function downloadXlsx(spec: SheetSpec) {
  const loaded: any = await import('exceljs');
  const ExcelJS: typeof import('exceljs') = loaded.default ?? loaded;
  const workbook = new ExcelJS.Workbook();
  const lastColumn = spec.columns.length;
  const titleRow = 1;
  const legendRow = spec.legend?.length ? 2 : 0;
  const headerRow = legendRow ? 3 : 2;
  const sheet = workbook.addWorksheet(spec.sheetName.slice(0, 31), {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 },
      printTitlesRow: `${headerRow}:${headerRow}`,
    },
    views: [{ state: 'frozen', xSplit: spec.frozenColumns ?? 0, ySplit: headerRow }],
  });
  spec.columns.forEach((column, i) => {
    sheet.getColumn(i + 1).width = column.width;
  });
  const thin = (hex: string) => ({ style: 'thin' as const, color: { argb: argb(hex) } });

  // ROMEO · the title · when it was printed, across the whole width.
  sheet.mergeCells(titleRow, 1, titleRow, lastColumn);
  const title = sheet.getCell(titleRow, 1);
  title.value = `ROMEO    ${spec.title}    (ພິມ: ${spec.printedAt})`;
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.border = { bottom: { style: 'medium', color: { argb: argb(TITLE_RULE) } } };
  sheet.getRow(titleRow).height = 28;

  if (legendRow) {
    sheet.mergeCells(legendRow, 1, legendRow, lastColumn);
    const legend = sheet.getCell(legendRow, 1);
    legend.value = {
      richText: spec.legend!.flatMap((item, i) => [
        ...(i ? [{ text: '     ' }] : []),
        { text: ` ${item.label} `, font: { bold: true, color: { argb: argb(item.color) ?? 'FF000000' } } },
        { text: ` ${item.text}`, font: { color: { argb: 'FF595959' } } },
      ]),
    };
    legend.alignment = { vertical: 'middle', wrapText: true };
  }

  const header = sheet.getRow(headerRow);
  spec.columns.forEach((column, i) => {
    const cell = header.getCell(i + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: argb(column.color ?? HEADER_TEXT) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(column.fill ?? HEADER_FILL) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: thin('#999999'), left: thin('#999999'), bottom: thin('#999999'), right: thin('#999999') };
  });
  header.height = 32;

  spec.rows.forEach((row, r) => {
    const sheetRow = sheet.getRow(headerRow + 1 + r);
    let lines = 1;
    row.forEach((input, c) => {
      const data = asCell(input);
      const cell = sheetRow.getCell(c + 1);
      cell.value = data.value ?? '';
      if (typeof data.value === 'string') lines = Math.max(lines, data.value.split('\n').length);
      const fill = argb(data.fill) ?? (spec.striped && r % 2 === 1 ? argb(STRIPE_FILL) : undefined);
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      if (data.numFmt) cell.numFmt = data.numFmt;
      const color = argb(data.color);
      cell.font = { bold: !!data.bold, ...(color ? { color: { argb: color } } : {}) };
      cell.alignment = { horizontal: data.align ?? 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: thin('#CCCCCC'), left: thin('#CCCCCC'), bottom: thin('#CCCCCC'), right: thin('#CCCCCC') };
    });
    sheetRow.height = Math.max(18, lines * 15);
  });

  if (spec.totals) {
    const totalsRow = sheet.getRow(headerRow + 1 + spec.rows.length);
    spec.columns.forEach((_, c) => {
      const data = asCell(spec.totals![c]);
      const cell = totalsRow.getCell(c + 1);
      cell.value = data.value ?? '';
      cell.font = { bold: true, color: { argb: argb(data.color ?? HEADER_TEXT) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(data.fill ?? HEADER_FILL) } };
      if (data.numFmt) cell.numFmt = data.numFmt;
      cell.alignment = { horizontal: data.align ?? 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'medium', color: { argb: argb(TITLE_RULE) } },
        left: thin('#999999'),
        bottom: thin('#999999'),
        right: thin('#999999'),
      };
    });
    totalsRow.height = 22;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${spec.fileName}.xlsx`);
}
