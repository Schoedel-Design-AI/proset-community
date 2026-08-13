import type { CellValue } from "@office-kit/xlsx/cell";

const MAX_SPREADSHEET_CONTENT_CHARS = 500_000;
const MAX_SPREADSHEET_ROWS = 20_000;
const MAX_SPREADSHEET_CELLS = 200_000;
const MAX_SPREADSHEET_COLUMNS = 16_384;
const MAX_COLUMN_WIDTH = 60;

function spreadsheetError(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

export function parseCsvRows(content: string): string[][] {
  const source = content.replace(/^\uFEFF/, "");
  if (!source.trim()) {
    throw spreadsheetError("Please add spreadsheet content first.");
  }
  if (source.length > MAX_SPREADSHEET_CONTENT_CHARS) {
    throw spreadsheetError("This spreadsheet is too large to export as one workbook.");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let cellCount = 0;

  const pushField = () => {
    row.push(field);
    field = "";
    if (row.length > MAX_SPREADSHEET_COLUMNS) {
      throw spreadsheetError(`A spreadsheet can contain up to ${MAX_SPREADSHEET_COLUMNS} columns.`);
    }
  };

  const pushRow = () => {
    pushField();
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
      if (rows.length > MAX_SPREADSHEET_ROWS) {
        throw spreadsheetError(`A spreadsheet can contain up to ${MAX_SPREADSHEET_ROWS} rows.`);
      }
      cellCount += row.length;
      if (cellCount > MAX_SPREADSHEET_CELLS) {
        throw spreadsheetError(`A spreadsheet can contain up to ${MAX_SPREADSHEET_CELLS} cells.`);
      }
    }
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      if (field.length > 0) {
        throw spreadsheetError("The CSV contains a quote in the middle of an unquoted field.");
      }
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw spreadsheetError("The CSV contains an unterminated quoted field.");
  }
  if (field.length > 0 || row.length > 0) pushRow();
  if (rows.length === 0) {
    throw spreadsheetError("Please add spreadsheet content first.");
  }
  return rows;
}

function worksheetTitle(title: string): string {
  const cleaned = title
    .replace(/[:\\/?*\[\]]/g, " ")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  if (!cleaned || cleaned.toLowerCase() === "history") return "Proset Data";
  return cleaned;
}

export async function generateSpreadsheetXlsx(
  content: string,
  title = "Proset Data",
): Promise<Buffer> {
  const [
    { workbookToBuffer },
    { setBold, setCellBackgroundColor, setFontColor },
    { columnLetterFromIndex },
    { addWorksheet, createWorkbook },
    {
      appendRows,
      getCell,
      makeFreezePane,
      makeAutoFilter,
      makeSheetView,
      setAutoFilter,
      setColumnWidth,
    },
  ] = await Promise.all([
    import("@office-kit/xlsx/node"),
    import("@office-kit/xlsx/styles"),
    import("@office-kit/xlsx/utils"),
    import("@office-kit/xlsx/workbook"),
    import("@office-kit/xlsx/worksheet"),
  ]);
  const rows = parseCsvRows(content);
  const workbook = createWorkbook();
  const worksheet = addWorksheet(workbook, worksheetTitle(title));
  const values = rows.map((row) => row as CellValue[]);
  appendRows(worksheet, values);

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (let column = 1; column <= maxColumns; column += 1) {
    const width = rows.reduce(
      (max, row) => Math.max(max, (row[column - 1] || "").length),
      0,
    );
    setColumnWidth(worksheet, column, Math.min(MAX_COLUMN_WIDTH, Math.max(10, width + 2)));

    const headerCell = getCell(worksheet, 1, column);
    if (headerCell) {
      setBold(workbook, headerCell);
      setCellBackgroundColor(workbook, headerCell, "FF0A1628");
      setFontColor(workbook, headerCell, "FFFFFFFF");
    }
  }

  if (maxColumns > 0) {
    worksheet.views.push(makeSheetView({ pane: makeFreezePane("A2") }));
    setAutoFilter(worksheet, makeAutoFilter({
      ref: `A1:${columnLetterFromIndex(maxColumns)}${Math.max(1, rows.length)}`,
    }));
  }

  return workbookToBuffer(workbook);
}
