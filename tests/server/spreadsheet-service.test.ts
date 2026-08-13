import assert from "node:assert/strict";
import test from "node:test";
import { extractDocumentText } from "../../server/document-parser";
import {
  generateSpreadsheetXlsx,
  parseCsvRows,
} from "../../server/spreadsheet-service";

test("CSV parser preserves quoted commas, quotes, and embedded newlines", () => {
  assert.deepEqual(
    parseCsvRows('Name,Notes\r\nBarry,"Line one,\nline ""two"""'),
    [
      ["Name", "Notes"],
      ["Barry", 'Line one,\nline "two"'],
    ],
  );
});

test("CSV parser rejects malformed quoted fields", () => {
  assert.throws(
    () => parseCsvRows('Name,Notes\nBarry,"unfinished'),
    /unterminated quoted field/i,
  );
});

test("generated XLSX round-trips through bounded spreadsheet ingestion", async () => {
  const buffer = await generateSpreadsheetXlsx(
    'Name,Count,Notes\nBarry,12,"Uses commas, safely"',
    "Quarterly Report",
  );
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");

  const extracted = await extractDocumentText(buffer, "xlsx");
  assert.match(extracted, /^\[WORKSHEET "Quarterly Report"\]/);
  assert.match(extracted, /Name,Count,Notes/);
  assert.match(extracted, /Barry,12,"Uses commas, safely"/);
});

test("XLSX export preserves formula-like CSV values as text", async () => {
  const [{ cellValueAsString }, { fromBuffer }, { loadWorkbookStream }] = await Promise.all([
    import("@office-kit/xlsx/cell"),
    import("@office-kit/xlsx/node"),
    import("@office-kit/xlsx/streaming"),
  ]);
  const buffer = await generateSpreadsheetXlsx(
    "Name,Value\nExample,=2+2",
    "Formula Safety",
  );
  const workbook = await loadWorkbookStream(fromBuffer(buffer));
  try {
    const sheet = workbook.openWorksheet("Formula Safety");
    const rows = [];
    for await (const row of sheet.iterRows()) rows.push(row);
    assert.equal(cellValueAsString(rows[1][1].value), "=2+2");
    assert.equal(typeof rows[1][1].value, "string");
  } finally {
    await workbook.close();
  }
});
