import type { CellValue } from "@office-kit/xlsx/cell";
import mammoth from "mammoth";
import sharp from "sharp";
import Tesseract from "tesseract.js";

export const DOCUMENT_PARSER_VERSION = "2026-07-23.2";

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_PDF_PAGES = 200;
const MAX_SCANNED_PDF_OCR_PAGES = 20;
const MAX_WORKSHEETS = 50;
const MAX_SPREADSHEET_ROWS = 20_000;
const MAX_SPREADSHEET_CELLS = 200_000;
const OCR_TIMEOUT_MS = 60_000;

function parserError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

function startsWithBytes(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function assertDocumentSignature(buffer: Buffer, extension: string): void {
  const ext = extension.replace(/^\./, "").toLowerCase();
  if (buffer.length === 0) throw parserError("The uploaded file is empty.");
  if (ext === "pdf" && buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw parserError("The file contents do not match a PDF document.");
  }
  if (ext === "png" && !startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    throw parserError("The file contents do not match a PNG image.");
  }
  if ((ext === "jpg" || ext === "jpeg") && !startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    throw parserError("The file contents do not match a JPEG image.");
  }
  if (
    ext === "webp"
    && (
      buffer.subarray(0, 4).toString("ascii") !== "RIFF"
      || buffer.subarray(8, 12).toString("ascii") !== "WEBP"
    )
  ) {
    throw parserError("The file contents do not match a WebP image.");
  }
  if (
    (ext === "docx" || ext === "xlsx")
    && !startsWithBytes(buffer, [0x50, 0x4b])
  ) {
    throw parserError(`The file contents do not match a .${ext} document.`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(parserError(message, 408)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function assertSafeImage(buffer: Buffer): Promise<void> {
  const metadata = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const pages = metadata.pages || 1;
  if (
    width < 1
    || height < 1
    || width > MAX_IMAGE_DIMENSION
    || height > MAX_IMAGE_DIMENSION
    || width * height * pages > MAX_IMAGE_PIXELS
  ) {
    throw parserError("The image dimensions are too large to process safely.", 413);
  }
  if (pages > 1) {
    throw parserError("Animated or multi-page images are not supported for context OCR.");
  }
}

async function recognizeImages(images: Buffer[], labels?: string[]): Promise<string> {
  const worker = await Tesseract.createWorker("eng");
  try {
    const sections: string[] = [];
    for (let index = 0; index < images.length; index += 1) {
      await assertSafeImage(images[index]);
      const result = await withTimeout(
        worker.recognize(images[index]),
        OCR_TIMEOUT_MS,
        "OCR took too long. Reduce the image size or split the document.",
      );
      const text = result.data.text.trim();
      if (text) {
        sections.push(`${labels?.[index] ? `${labels[index]}\n` : ""}${text}`);
      }
    }
    return sections.join("\n\n");
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfModule = await import("pdf-parse");
  const parser = new pdfModule.PDFParse({ data: buffer });
  try {
    const info = await withTimeout(
      parser.getInfo(),
      30_000,
      "The PDF took too long to inspect.",
    );
    if (info.total > MAX_PDF_PAGES) {
      throw parserError(
        `This PDF has ${info.total} pages. Split it into documents of ${MAX_PDF_PAGES} pages or fewer.`,
        413,
      );
    }
    const result = await withTimeout(
      parser.getText(),
      60_000,
      "The PDF took too long to read. Split it into smaller documents.",
    );
    if (result.text.trim()) {
      return result.pages
        .map((page) => `[PDF PAGE ${page.num}]\n${page.text.trim()}`)
        .filter((page) => !page.endsWith("]\n"))
        .join("\n\n");
    }
    if (info.total > MAX_SCANNED_PDF_OCR_PAGES) {
      throw parserError(
        `This appears to be a scanned PDF with ${info.total} pages. OCR supports up to ${MAX_SCANNED_PDF_OCR_PAGES} pages per upload; split the PDF and try again.`,
        413,
      );
    }
    const screenshots = await withTimeout(
      parser.getScreenshot({
        first: info.total,
        desiredWidth: 1600,
        imageBuffer: true,
        imageDataUrl: false,
      }),
      60_000,
      "The scanned PDF took too long to render for OCR.",
    );
    return recognizeImages(
      screenshots.pages.map((page) => Buffer.from(page.data)),
      screenshots.pages.map((page) => `[PDF PAGE ${page.pageNumber} — OCR]`),
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function csvCell(value: CellValue, stringify: (cell: CellValue) => string): string {
  const text = stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function extractSpreadsheetText(buffer: Buffer): Promise<string> {
  const [{ cellValueAsString }, { fromBuffer }, { loadWorkbookStream }] = await Promise.all([
    import("@office-kit/xlsx/cell"),
    import("@office-kit/xlsx/node"),
    import("@office-kit/xlsx/streaming"),
  ]);
  const workbook = await withTimeout(
    loadWorkbookStream(fromBuffer(buffer)),
    60_000,
    "The spreadsheet took too long to read. Split it into smaller workbooks.",
  );
  try {
    if (workbook.sheetNames.length > MAX_WORKSHEETS) {
      throw parserError(`A workbook can contain up to ${MAX_WORKSHEETS} worksheets.`, 413);
    }
    let rowCount = 0;
    let cellCount = 0;
    const deadline = Date.now() + 60_000;
    const sections: string[] = [];
    for (const sheetName of workbook.sheetNames) {
      const sheet = workbook.openWorksheet(sheetName);
      const rows: string[] = [];
      for await (const cells of sheet.iterRows()) {
        if (Date.now() > deadline) {
          throw parserError("The spreadsheet took too long to read. Split it into smaller workbooks.", 408);
        }
        if (cells.length === 0) continue;
        rowCount += 1;
        const maxColumn = cells.reduce((max, cell) => Math.max(max, cell.col), 0);
        cellCount += maxColumn;
        if (rowCount > MAX_SPREADSHEET_ROWS || cellCount > MAX_SPREADSHEET_CELLS) {
          throw parserError(
            `The workbook exceeds the safe limit of ${MAX_SPREADSHEET_ROWS} rows or ${MAX_SPREADSHEET_CELLS} cells. Split it and upload the parts.`,
            413,
          );
        }
        const values: CellValue[] = Array.from({ length: maxColumn }, () => null);
        for (const cell of cells) values[cell.col - 1] = cell.value;
        rows.push(values.map((value) => csvCell(value, cellValueAsString)).join(","));
      }
      sections.push(`[WORKSHEET ${JSON.stringify(sheet.title)}]\n${rows.join("\n")}`);
    }
    return sections.join("\n\n");
  } finally {
    await workbook.close().catch(() => undefined);
  }
}

function extractUtf8Text(buffer: Buffer): string {
  if (buffer.includes(0)) {
    throw parserError("The file contains binary data and cannot be read as text.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw parserError("The text file is not valid UTF-8. Save it as UTF-8 and try again.");
  }
}

export async function extractDocumentText(
  buffer: Buffer,
  extension: string,
): Promise<string> {
  const fileExt = extension.trim().toLowerCase().replace(/^\./, "");
  assertDocumentSignature(buffer, fileExt);
  if (fileExt === "docx") {
    return withTimeout(
      mammoth.extractRawText({ buffer }).then((result) => result.value),
      60_000,
      "The Word document took too long to read. Split it into smaller documents.",
    );
  }
  if (fileExt === "pdf") return extractPdfText(buffer);
  if (["png", "jpg", "jpeg", "webp"].includes(fileExt)) {
    return recognizeImages([buffer]);
  }
  if (fileExt === "xlsx") return extractSpreadsheetText(buffer);
  if (fileExt === "xls") {
    throw parserError(
      "Legacy .xls files are not supported reliably. Save the workbook as .xlsx or .csv and upload it again.",
    );
  }
  return extractUtf8Text(buffer);
}
