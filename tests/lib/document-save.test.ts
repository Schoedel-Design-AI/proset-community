import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentSaver, encodeSourceUri, type PickerApi } from "../../lib/document-save";

const errorCodes = { OPERATION_CANCELED: "OPERATION_CANCELED" };

function fakePicker(overrides: Partial<PickerApi> = {}): PickerApi & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    saveDocuments: async (options: any) => {
      calls.push(options);
      return [{ uri: "content://downloads/1", name: "chosen.txt", error: null }];
    },
    isErrorWithCode: (err: any) => typeof err?.code === "string",
    errorCodes,
    ...overrides,
  } as PickerApi & { calls: any[] };
}

test("a saved document reports the name the user chose", async () => {
  const picker = fakePicker();
  const save = createDocumentSaver(picker);
  const result = await save({ fileUri: "file:///cache/notes.txt", fileName: "notes.txt", mimeType: "text/plain" });
  assert.deepEqual(result, { status: "saved", fileName: "chosen.txt", uri: "content://downloads/1" });
});

test("the picker receives one encoded source uri, the mime type, and copy:true", async () => {
  const picker = fakePicker();
  await createDocumentSaver(picker)({
    fileUri: "/data/cache/My Notes.txt",
    fileName: "My Notes.txt",
    mimeType: "text/plain",
  });
  assert.equal(picker.calls.length, 1);
  assert.deepEqual(picker.calls[0], {
    sourceUris: ["file:///data/cache/My%20Notes.txt"],
    mimeType: "text/plain",
    fileName: "My Notes.txt",
    copy: true,
  });
});

test("a dismissed dialog is cancellation, not failure", async () => {
  const picker = fakePicker({
    saveDocuments: async () => {
      const err: any = new Error("User canceled document picker");
      err.code = "OPERATION_CANCELED";
      throw err;
    },
  });
  const result = await createDocumentSaver(picker)({
    fileUri: "file:///cache/a.txt",
    fileName: "a.txt",
    mimeType: "text/plain",
  });
  assert.deepEqual(result, { status: "cancelled" });
});

test("any other coded error propagates", async () => {
  const picker = fakePicker({
    saveDocuments: async () => {
      const err: any = new Error("no permission");
      err.code = "IN_PROGRESS";
      throw err;
    },
  });
  await assert.rejects(
    () => createDocumentSaver(picker)({ fileUri: "file:///cache/a.txt", fileName: "a.txt", mimeType: "text/plain" }),
    /no permission/,
  );
});

test("a per-file write error is surfaced instead of reported as success", async () => {
  const picker = fakePicker({
    saveDocuments: async () => [{ uri: "content://x", name: "a.txt", error: "ENOSPC" }],
  });
  await assert.rejects(
    () => createDocumentSaver(picker)({ fileUri: "file:///cache/a.txt", fileName: "a.txt", mimeType: "text/plain" }),
    /ENOSPC/,
  );
});

test("an empty picker response is an error, not a silent success", async () => {
  const picker = fakePicker({ saveDocuments: async () => [] as any });
  await assert.rejects(
    () => createDocumentSaver(picker)({ fileUri: "file:///cache/a.txt", fileName: "a.txt", mimeType: "text/plain" }),
    /no result/,
  );
});

test("a missing chosen name falls back to the requested name", async () => {
  const picker = fakePicker({
    saveDocuments: async () => [{ uri: "content://x", name: null, error: null }],
  });
  const result = await createDocumentSaver(picker)({
    fileUri: "file:///cache/a.txt",
    fileName: "a.txt",
    mimeType: "text/plain",
  });
  assert.equal(result.status === "saved" && result.fileName, "a.txt");
});

test("encodeSourceUri adds the scheme once and never double-encodes", () => {
  assert.equal(encodeSourceUri("/cache/a b.txt"), "file:///cache/a%20b.txt");
  assert.equal(encodeSourceUri("file:///cache/a b.txt"), "file:///cache/a%20b.txt");
  assert.equal(encodeSourceUri("file:///cache/a%20b.txt"), "file:///cache/a%20b.txt");
});
