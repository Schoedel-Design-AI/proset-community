/**
 * Print failures as values.
 *
 * The UI must never parse a message string. Every failure crosses this boundary as a
 * PrintError carrying:
 *   - code            stable machine category (switch on this)
 *   - phase           where it happened: building options, generating, or presenting
 *   - retryable       whether a second attempt can plausibly succeed
 *   - nativeCode      the raw code from react-native-html-to-pdf / the browser, for logs
 *   - userMessageKey  an i18n key (both en and es exist — see lib/i18n.tsx)
 *
 * The native-code table mirrors the published Android source of
 * react-native-html-to-pdf@1.3.0 (HtmlToPdfModule.kt + android/print/PdfConverter.kt),
 * which is the only authority on which codes can appear at runtime.
 *
 * Pure module: no react-native import, so the Node test runner covers every branch.
 */

import { PrintTimeoutError } from "./print-async";

export type PrintErrorCode =
  | "invalid_options" // bad HTML/file name/output folder — never retryable
  | "unsupported_platform" // no engine for this platform
  | "conversion_in_progress" // converter singleton busy — retryable, auto-retried once
  | "pdf_generation_timeout" // our supervisor timeout OR the library's 30 s watchdog
  | "pdf_generation_failed" // write failed, conversion failed
  | "webview_failed" // WebView layout/page-load/setup failure
  | "print_dialog_unavailable" // nothing to present the result with
  | "print_blocked" // browser refused to open the print dialog (no user gesture / CSP)
  | "user_cancelled"
  | "unknown";

export type PrintPhaseName = "options" | "generate" | "present";

type NativeMapping = { code: PrintErrorCode; retryable: boolean };

const NATIVE_CODE_MAP: Record<string, NativeMapping> = {
  INVALID_HTML: { code: "invalid_options", retryable: false },
  INVALID_FILENAME: { code: "invalid_options", retryable: false },
  FOLDER_ERROR: { code: "invalid_options", retryable: false },
  CONVERSION_IN_PROGRESS: { code: "conversion_in_progress", retryable: true },
  CONVERSION_SETUP_ERROR: { code: "webview_failed", retryable: true },
  PDF_CONVERSION_TIMEOUT: { code: "pdf_generation_timeout", retryable: true },
  PDF_LAYOUT_FAILED: { code: "webview_failed", retryable: true },
  PDF_PAGE_LOAD_ERROR: { code: "webview_failed", retryable: true },
  WEBVIEW_ERROR: { code: "webview_failed", retryable: true },
  PDF_WEBVIEW_SETUP_ERROR: { code: "webview_failed", retryable: true },
  PDF_WRITE_ERROR: { code: "pdf_generation_failed", retryable: true },
  PDF_WRITE_FAILED: { code: "pdf_generation_failed", retryable: true },
  PDF_WRITE_CANCELLED: { code: "pdf_generation_failed", retryable: false },
  PDF_GENERATION_ERROR: { code: "pdf_generation_failed", retryable: false },
  PDF_CONVERSION_ERROR: { code: "pdf_generation_failed", retryable: false },
};

/** Our own signal that the user cancelled before the job reached the print dialog. */
export const CANCELLED_SENTINEL = "__cancelled__";

export const PRINT_ERROR_MESSAGE_KEYS: Record<PrintErrorCode, string> = {
  invalid_options: "print.error.invalid_options",
  unsupported_platform: "print.error.unsupported_platform",
  conversion_in_progress: "print.error.conversion_in_progress",
  pdf_generation_timeout: "print.error.pdf_generation_timeout",
  pdf_generation_failed: "print.error.pdf_generation_failed",
  webview_failed: "print.error.webview_failed",
  print_dialog_unavailable: "print.error.print_dialog_unavailable",
  print_blocked: "print.error.print_blocked",
  user_cancelled: "print.error.user_cancelled",
  unknown: "print.error.unknown",
};

const RETRYABLE_BY_CODE: Partial<Record<PrintErrorCode, boolean>> = {
  conversion_in_progress: true,
  pdf_generation_timeout: true,
  pdf_generation_failed: true,
  webview_failed: true,
  unknown: true,
};

export type PrintErrorInit = {
  retryable?: boolean;
  nativeCode?: string | null;
  cause?: unknown;
};

export class PrintError extends Error {
  readonly code: PrintErrorCode;
  readonly phase: PrintPhaseName;
  readonly retryable: boolean;
  readonly nativeCode: string | null;
  readonly userMessageKey: string;

  constructor(code: PrintErrorCode, phase: PrintPhaseName, message: string, init: PrintErrorInit = {}) {
    super(message);
    this.name = "PrintError";
    this.code = code;
    this.phase = phase;
    this.retryable = init.retryable ?? RETRYABLE_BY_CODE[code] ?? false;
    this.nativeCode = init.nativeCode ?? null;
    this.userMessageKey = PRINT_ERROR_MESSAGE_KEYS[code];
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }

  /** Safe for logs and the bug reporter — contains no user document content. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      phase: this.phase,
      retryable: this.retryable,
      nativeCode: this.nativeCode,
      message: this.message,
    };
  }
}

export function isPrintError(value: unknown): value is PrintError {
  return value instanceof PrintError;
}

/** Pull a SCREAMING_SNAKE native/Error code out of whatever the platform threw. */
export function extractNativeCode(raw: unknown): string | null {
  if (typeof raw === "string") return /^[A-Z][A-Z0-9_]{2,}$/.test(raw) ? raw : null;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { code?: unknown; nativeCode?: unknown; message?: unknown };
  for (const value of [candidate.code, candidate.nativeCode, candidate.message]) {
    if (typeof value === "string" && /^[A-Z][A-Z0-9_]{2,}$/.test(value)) return value;
  }
  return null;
}

function messageOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { message?: unknown }).message === "string") {
    return (raw as { message: string }).message;
  }
  return "print failed";
}

/**
 * Single entry point for turning anything thrown into a PrintError.
 *
 * Order matters: our own PrintError, then our timeout, then the platform code table, then
 * cancellation, then a phase-specific default.
 */
export function classifyPrintFailure(raw: unknown, phase: PrintPhaseName): PrintError {
  if (isPrintError(raw)) return raw;

  const message = messageOf(raw);
  if (message === CANCELLED_SENTINEL) {
    return new PrintError("user_cancelled", phase, "print cancelled by the user");
  }

  if (raw instanceof PrintTimeoutError || (raw as { name?: string } | null)?.name === "TimeoutError") {
    return new PrintError("pdf_generation_timeout", phase, message, { retryable: true, cause: raw });
  }

  const nativeCode = extractNativeCode(raw);
  const mapped = nativeCode ? NATIVE_CODE_MAP[nativeCode] : undefined;
  if (mapped) {
    return new PrintError(mapped.code, phase, message, {
      retryable: mapped.retryable,
      nativeCode,
      cause: raw,
    });
  }

  if ((raw as { name?: string } | null)?.name === "AbortError") {
    return new PrintError("user_cancelled", phase, message, { cause: raw });
  }
  if (phase === "present" && (raw as { name?: string } | null)?.name === "NotAllowedError") {
    // Chrome/Safari refuse window.print() without a live user gesture, or under a
    // restrictive sandbox/CSP. Retrying without a new tap cannot help.
    return new PrintError("print_blocked", phase, message, { retryable: false, cause: raw });
  }
  if (/user did not share|cancel/i.test(message)) {
    return new PrintError("user_cancelled", phase, message, { cause: raw });
  }

  return new PrintError(phase === "present" ? "print_dialog_unavailable" : "unknown", phase, message, {
    cause: raw,
  });
}
