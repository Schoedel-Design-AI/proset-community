import assert from "node:assert/strict";
import test from "node:test";

import { PrintTimeoutError } from "../../lib/print/print-async";
import {
  PrintError,
  PRINT_ERROR_MESSAGE_KEYS,
  classifyPrintFailure,
  extractNativeCode,
  isPrintError,
} from "../../lib/print/print-errors";

test("native conversion timeout is classified as a retryable generation timeout", () => {
  const error = classifyPrintFailure(
    { code: "PDF_CONVERSION_TIMEOUT", message: "PDF conversion timed out" },
    "generate",
  );
  assert.equal(error.code, "pdf_generation_timeout");
  assert.equal(error.retryable, true);
  assert.equal(error.nativeCode, "PDF_CONVERSION_TIMEOUT");
  assert.equal(error.userMessageKey, PRINT_ERROR_MESSAGE_KEYS.pdf_generation_timeout);
});

test("a concurrent conversion is its own retryable category, not a generic failure", () => {
  const error = classifyPrintFailure({ code: "CONVERSION_IN_PROGRESS" }, "generate");
  assert.equal(error.code, "conversion_in_progress");
  assert.equal(error.retryable, true);
});

test("webview and layout failures are grouped as webview failures", () => {
  for (const code of ["PDF_LAYOUT_FAILED", "WEBVIEW_ERROR", "PDF_PAGE_LOAD_ERROR", "CONVERSION_SETUP_ERROR"]) {
    assert.equal(classifyPrintFailure({ code }, "generate").code, "webview_failed");
  }
});

test("bad input codes are invalid_options and never retryable", () => {
  for (const code of ["INVALID_HTML", "INVALID_FILENAME", "FOLDER_ERROR"]) {
    const error = classifyPrintFailure({ code }, "generate");
    assert.equal(error.code, "invalid_options");
    assert.equal(error.retryable, false);
  }
});

test("our own supervisor timeout is a generation timeout", () => {
  const error = classifyPrintFailure(new PrintTimeoutError("pdf-generation", 45000), "generate");
  assert.equal(error.code, "pdf_generation_timeout");
});

test("user cancellation is recognised from the text, from AbortError, and from our sentinel", () => {
  assert.equal(classifyPrintFailure(new Error("User did not share"), "present").code, "user_cancelled");
  assert.equal(
    classifyPrintFailure(Object.assign(new Error("aborted"), { name: "AbortError" }), "present").code,
    "user_cancelled",
  );
  assert.equal(classifyPrintFailure("__cancelled__", "generate").code, "user_cancelled");
});

test("a blocked print dialog is distinguished from a missing one", () => {
  assert.equal(
    classifyPrintFailure(Object.assign(new Error("blocked"), { name: "NotAllowedError" }), "present").code,
    "print_blocked",
  );
  assert.equal(classifyPrintFailure(new Error("nothing happened"), "present").code, "print_dialog_unavailable");
});

test("an existing PrintError passes through untouched", () => {
  const original = new PrintError("pdf_generation_failed", "generate", "boom");
  assert.equal(classifyPrintFailure(original, "present"), original);
});

test("extractNativeCode only accepts SCREAMING_SNAKE tokens", () => {
  assert.equal(extractNativeCode({ code: "PDF_WRITE_ERROR" }), "PDF_WRITE_ERROR");
  assert.equal(extractNativeCode({ message: "PDF_WRITE_FAILED" }), "PDF_WRITE_FAILED");
  assert.equal(extractNativeCode({ message: "some lower case text" }), null);
  assert.equal(extractNativeCode(new Error("plain")), null);
  assert.equal(extractNativeCode(null), null);
});

test("isPrintError narrows, and every code has an i18n key", () => {
  assert.equal(isPrintError(new PrintError("invalid_options", "options", "x")), true);
  assert.equal(isPrintError(new Error("x")), false);
  for (const [code, key] of Object.entries(PRINT_ERROR_MESSAGE_KEYS)) {
    assert.equal(key, `print.error.${code}`);
  }
});
